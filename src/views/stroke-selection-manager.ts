import { InkView } from './InkView';
import { Stroke, Point, BoundingBox, StrokeSelection, Block, StrokeStyle } from '../types';
import { Notice } from 'obsidian';

export class StrokeSelectionManager {
  private context: InkView;
  
  // Selection state
  public selectedStrokes: Set<string> = new Set();
  public selectionRect: { x: number; y: number; width: number; height: number } | null = null;
  public isSelecting: boolean = false;
  public selectionStart: Point | null = null;
  
  // Drag state
  public isDragging: boolean = false;
  public dragOffset: Point = { x: 0, y: 0, t: 0, pressure: 0.5 };
  public dragStart: Point = { x: 0, y: 0, t: 0, pressure: 0.5 };
  
  // Copy buffer
  public copiedStrokes: Stroke[] = [];
  
  constructor(context: InkView) {
    this.context = context;
  }
  
  public setupCanvasSelection(canvas: HTMLCanvasElement, blockIndex: number): void {
    let isMouseDown = false;
    let startPoint: Point | null = null;
    let selectionBox: HTMLElement | null = null;
    
    const getCanvasPoint = (e: MouseEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      return { x, y, t: Date.now(), pressure: 0.5 };
    };
    
    // Handle mouse down for selection
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // Only left mouse button
      if (this.context.drawingManager.currentTool !== 'selection') return;
      
      const point = getCanvasPoint(e);
      startPoint = point;
      isMouseDown = true;
      
      // Check if clicking on existing stroke
      const clickedStrokeId = this.getStrokeAtPoint(point, blockIndex);
      
      if (clickedStrokeId) {
        // Handle stroke selection
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // Add to selection with modifier key
          this.toggleStrokeSelection(clickedStrokeId);
        } else {
          // Start dragging selected strokes
          if (this.selectedStrokes.has(clickedStrokeId)) {
            this.startDragging(point);
          } else {
            // Select single stroke
            this.selectedStrokes.clear();
            this.selectedStrokes.add(clickedStrokeId);
          }
        }
      } else {
        // Start rectangle selection
        this.isSelecting = true;
        this.selectionStart = point;
        
        // Create selection rectangle
        selectionBox = document.createElement('div');
        selectionBox.className = 'stroke-selection-box';
        selectionBox.style.position = 'absolute';
        selectionBox.style.border = '2px dashed var(--interactive-accent)';
        selectionBox.style.background = 'rgba(var(--interactive-accent-rgb), 0.1)';
        selectionBox.style.pointerEvents = 'none';
        canvas.parentElement?.appendChild(selectionBox);
      }
      
      this.redrawCanvas(canvas, blockIndex);
      e.preventDefault();
    };
    
    // Handle mouse move for selection/dragging
    const handleMouseMove = (e: MouseEvent) => {
      if (!isMouseDown) return;
      
      const currentPoint = getCanvasPoint(e);
      
      if (this.isDragging) {
        // Handle dragging strokes
        const dx = currentPoint.x - this.dragStart.x;
        const dy = currentPoint.y - this.dragStart.y;
        this.dragOffset = { x: dx, y: dy, t: 0, pressure: 0.5 };
        this.updateStrokePositions(dx, dy, blockIndex);
        this.dragStart = currentPoint;
        this.redrawCanvas(canvas, blockIndex);
      } else if (this.isSelecting && startPoint && selectionBox) {
        // Update selection rectangle
        const x = Math.min(startPoint.x, currentPoint.x);
        const y = Math.min(startPoint.y, currentPoint.y);
        const width = Math.abs(currentPoint.x - startPoint.x);
        const height = Math.abs(currentPoint.y - startPoint.y);
        
        const canvasRect = canvas.getBoundingClientRect();
        selectionBox.style.left = `${canvasRect.left + x * (canvasRect.width / canvas.width)}px`;
        selectionBox.style.top = `${canvasRect.top + y * (canvasRect.height / canvas.height)}px`;
        selectionBox.style.width = `${width * (canvasRect.width / canvas.width)}px`;
        selectionBox.style.height = `${height * (canvasRect.height / canvas.height)}px`;
      }
    };
    
    // Handle mouse up to complete selection/dragging
    const handleMouseUp = (e: MouseEvent) => {
      if (!isMouseDown) return;
      
      if (this.isSelecting && startPoint) {
        // Complete rectangle selection
        const endPoint = getCanvasPoint(e);
        const x1 = Math.min(startPoint.x, endPoint.x);
        const y1 = Math.min(startPoint.y, endPoint.y);
        const x2 = Math.max(startPoint.x, endPoint.x);
        const y2 = Math.max(startPoint.y, endPoint.y);
        
        this.selectStrokesInRectangle(
          { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
          blockIndex,
          e.shiftKey || e.ctrlKey || e.metaKey
        );
        
        // Clean up selection box
        if (selectionBox) {
          selectionBox.remove();
          selectionBox = null;
        }
        
        this.isSelecting = false;
        this.selectionStart = null;
      }
      
      if (this.isDragging) {
        // Complete dragging
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0, t: 0, pressure: 0.5 };
        
        // Save the moved strokes
        this.context.saveDocument();
      }
      
      isMouseDown = false;
      startPoint = null;
      this.redrawCanvas(canvas, blockIndex);
    };
    
    // Event listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
  }
  
  private getStrokeAtPoint(point: Point, blockIndex: number): string | null {
    const block = this.context.blocks[blockIndex];
    if (!block || !this.context.document) return null;
    
    const tolerance = 10; // Pixel tolerance for selection
    
    for (const strokeId of block.strokeIds) {
      const stroke = this.context.document.strokes.find(s => s.id === strokeId);
      if (!stroke) continue;
      
      // Check distance to stroke points
      for (const p of stroke.points) {
        const distance = Math.sqrt(
          Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2)
        );
        if (distance <= tolerance) {
          return strokeId;
        }
      }
      
      // Check distance to stroke segments
      for (let i = 0; i < stroke.points.length - 1; i++) {
        const p1 = stroke.points[i];
        const p2 = stroke.points[i + 1];
        if (!p1 || !p2) continue;
        
        const distance = this.distanceToLineSegment(point, p1, p2);
        if (distance <= tolerance) {
          return strokeId;
        }
      }
    }
    
    return null;
  }
  
  private distanceToLineSegment(point: Point, lineStart: Point, lineEnd: Point): number {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) {
      param = dot / lenSq;
    }
    
    let xx, yy;
    
    if (param < 0) {
      xx = lineStart.x;
      yy = lineStart.y;
    } else if (param > 1) {
      xx = lineEnd.x;
      yy = lineEnd.y;
    } else {
      xx = lineStart.x + param * C;
      yy = lineStart.y + param * D;
    }
    
    const dx = point.x - xx;
    const dy = point.y - yy;
    
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  public toggleStrokeSelection(strokeId: string): void {
    if (this.selectedStrokes.has(strokeId)) {
      this.selectedStrokes.delete(strokeId);
    } else {
      this.selectedStrokes.add(strokeId);
    }
  }
  
  private selectStrokesInRectangle(rect: BoundingBox, blockIndex: number, addToSelection: boolean): void {
    const block = this.context.blocks[blockIndex];
    if (!block || !this.context.document) return;
    
    if (!addToSelection) {
      this.selectedStrokes.clear();
    }
    
    for (const strokeId of block.strokeIds) {
      const stroke = this.context.document.strokes.find(s => s.id === strokeId);
      if (!stroke) continue;
      
      // Check if any point of the stroke is within the rectangle
      for (const point of stroke.points) {
        if (point.x >= rect.x && point.x <= rect.x + rect.width &&
            point.y >= rect.y && point.y <= rect.y + rect.height) {
          this.selectedStrokes.add(strokeId);
          break;
        }
      }
    }
  }
  
  private startDragging(startPoint: Point): void {
    this.isDragging = true;
    this.dragStart = startPoint;
    this.dragOffset = { x: 0, y: 0, t: 0, pressure: 0.5 };
  }
  
  private updateStrokePositions(dx: number, dy: number, blockIndex: number): void {
    const block = this.context.blocks[blockIndex];
    if (!block || !this.context.document) return;
    
    this.selectedStrokes.forEach(strokeId => {
      const stroke = this.context.document?.getStroke(strokeId);
      if (stroke) {
        // Update all points in the stroke
        stroke.points = stroke.points.map(p => ({
          ...p,
          x: p.x + dx,
          y: p.y + dy
        }));
        
        // Update bezier curves if they exist
        if (stroke.bezierCurves) {
          stroke.bezierCurves = stroke.bezierCurves.map(curve => ({
            ...curve,
            p0: { ...curve.p0, x: curve.p0.x + dx, y: curve.p0.y + dy },
            p1: { ...curve.p1, x: curve.p1.x + dx, y: curve.p1.y + dy },
            p2: { ...curve.p2, x: curve.p2.x + dx, y: curve.p2.y + dy },
            p3: { ...curve.p3, x: curve.p3.x + dx, y: curve.p3.y + dy }
          }));
        }
        
        // Update the stroke in the document
        if (this.context.document)
        this.context.document.updateStroke(strokeId, stroke);
      }
    });
  }
  
  private redrawCanvas(canvas: HTMLCanvasElement, blockIndex: number): void {
    const block = this.context.blocks[blockIndex];
    if (block) {
      this.context.drawingManager.drawBlockStrokes(canvas, block);
      this.drawSelectionHighlights(canvas, block);
    }
  }
  
  public drawSelectionHighlights(canvas: HTMLCanvasElement, block: Block): void {
    if (!this.context.document || this.selectedStrokes.size === 0) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Draw selection highlights
    ctx.strokeStyle = 'var(--interactive-accent)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    
    this.selectedStrokes.forEach(strokeId => {
      const stroke = this.context.document?.getStroke(strokeId);
      if (!stroke || !block.strokeIds.includes(strokeId)) return;
      
      // Draw bounding box around selected stroke
      if (stroke.points.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const point of stroke.points) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
        
        const padding = 5;
        ctx.strokeRect(
          minX - padding, minY - padding,
          maxX - minX + 2 * padding,
          maxY - minY + 2 * padding
        );
      }
    });
    
    ctx.setLineDash([]);
  }
  
  public copySelectedStrokes(): void {
    if (!this.context.document) return;
    
    this.copiedStrokes = [];
    this.selectedStrokes.forEach(strokeId => {
      const stroke = this.context.document?.getStroke(strokeId);
      if (stroke) {
        // Create a deep copy
        const copiedStroke: Stroke = {
          ...stroke,
          id: crypto.randomUUID(), // New ID for copied stroke
          points: stroke.points.map(p => ({ ...p })),
          bezierCurves: stroke.bezierCurves?.map(c => ({ ...c }))
        };
        this.copiedStrokes.push(copiedStroke);
      }
    });
    
    new Notice(`Copied ${this.copiedStrokes.length} stroke(s)`);
  }
  
  public pasteStrokes(blockIndex: number, offset: Point = { x: 10, y: 10, t: 0, pressure: 0.5 }): void {
    if (this.copiedStrokes.length === 0) return;
    
    const block = this.context.blocks[blockIndex];
    if (!block || !this.context.document) return;
    
    this.selectedStrokes.clear();
    
    this.copiedStrokes.forEach(originalStroke => {
      // Create new stroke with offset
      const newStroke: Stroke = {
        ...originalStroke,
        id: crypto.randomUUID(),
        points: originalStroke.points.map(p => ({
          ...p,
          x: p.x + offset.x,
          y: p.y + offset.y
        })),
        bezierCurves: originalStroke.bezierCurves?.map(curve => ({
          ...curve,
          p0: { ...curve.p0, x: curve.p0.x + offset.x, y: curve.p0.y + offset.y },
          p1: { ...curve.p1, x: curve.p1.x + offset.x, y: curve.p1.y + offset.y },
          p2: { ...curve.p2, x: curve.p2.x + offset.x, y: curve.p2.y + offset.y },
          p3: { ...curve.p3, x: curve.p3.x + offset.x, y: curve.p3.y + offset.y }
        }))
      };
      
      if (!this.context.document) {
        return;
      }
      const addedStroke = this.context.document.addStroke(newStroke);
      block.strokeIds.push(addedStroke.id);
      this.selectedStrokes.add(addedStroke.id);
    });
    
    new Notice(`Pasted ${this.copiedStrokes.length} stroke(s)`);
    this.context.blockManager.renderBlocks();
  }
  
  public deleteSelectedStrokes(): void {
    if (this.selectedStrokes.size === 0 || !this.context.document) return;
    
    const count = this.selectedStrokes.size;
    
    // Remove from current block
    const currentBlock = this.context.blocks[this.context.currentBlockIndex];
    if (currentBlock) {
      currentBlock.strokeIds = currentBlock.strokeIds.filter(id => !this.selectedStrokes.has(id));
    }
    
    // Remove from document
    this.selectedStrokes.forEach(strokeId => {
      this.context.document?.removeStroke(strokeId);
    });
    
    this.selectedStrokes.clear();
    this.context.blockManager.renderBlocks();
    new Notice(`Deleted ${count} stroke(s)`);
  }
  
  public applyStyleToSelectedStrokes(style: Partial<StrokeStyle>): void {
    if (!this.context.document || this.selectedStrokes.size === 0) return;
    
    this.selectedStrokes.forEach(strokeId => {
      const stroke = this.context.document?.getStroke(strokeId);
      if (stroke) {
        const newStyle = { ...stroke.style, ...style };
        if (this.context.document)
        this.context.document.updateStroke(strokeId, { style: newStyle });
      }
    });
    
    this.context.blockManager.renderBlocks();
    new Notice(`Updated style for ${this.selectedStrokes.size} stroke(s)`);
  }
  
  public clearSelection(): void {
    this.selectedStrokes.clear();
    this.isSelecting = false;
    this.isDragging = false;
    this.context.blockManager.renderBlocks();
  }
}