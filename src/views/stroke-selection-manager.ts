import { InkView } from './InkView';
import { Stroke, Point, BoundingBox, StrokeStyle, Block } from '../types';
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
    public dragStartPoint: Point | null = null;
    public dragOffset: Point = { x: 0, y: 0 };
    private originalStrokePositions: Map<string, Point[]> = new Map();

    // Copy buffer
    public copiedStrokes: Stroke[] = [];

    constructor(context: InkView) {
        this.context = context;
    }

    private getStrokeAtPoint(point: Point, blockIndex: number): string | null {
        const block = this.context.blocks[blockIndex];
        if (!block || !this.context.document) return null;

        const tolerance = 10;

        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.strokes.find(s => s.id === strokeId);
            if (!stroke) continue;

            for (const p of stroke.points) {
                const distance = Math.sqrt(
                    Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2)
                );
                if (distance <= tolerance) {
                    return strokeId;
                }
            }

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

    public selectStrokesInRectangle(rect: BoundingBox, blockIndex: number, addToSelection: boolean): void {
        const block = this.context.blocks[blockIndex];
        if (!block || !this.context.document) return;

        if (!addToSelection) {
            this.selectedStrokes.clear();
        }

        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.strokes.find(s => s.id === strokeId);
            if (!stroke) continue;

            for (const point of stroke.points) {
                if (point.x >= rect.x && point.x <= rect.x + rect.width &&
                    point.y >= rect.y && point.y <= rect.y + rect.height) {
                    this.selectedStrokes.add(strokeId);
                    break;
                }
            }
        }
    }

    public startDragging(startPoint: Point): void {
        this.isDragging = true;
        this.dragStartPoint = startPoint;
        this.dragOffset = { x: 0, y: 0 };
        this.originalStrokePositions.clear();

        // Store original positions
        this.selectedStrokes.forEach(strokeId => {
            const stroke = this.context.document?.getStroke(strokeId);
            if (stroke) {
                this.originalStrokePositions.set(strokeId, stroke.points.map(p => ({ ...p })));
            }
        });
    }

    public updateDraggingSelection(currentPoint: Point, dx: number, dy: number): void {
        if (!this.isDragging || !this.dragStartPoint) return;

        this.dragOffset = { x: dx, y: dy };

        this.selectedStrokes.forEach(strokeId => {
            const originalPoints = this.originalStrokePositions.get(strokeId);
            if (!originalPoints) return;

            const stroke = this.context.document?.getStroke(strokeId);
            if (!stroke) return;

            stroke.points = originalPoints.map(p => ({
                ...p,
                x: p.x + dx,
                y: p.y + dy
            }));

            if (stroke.bezierCurves) {
                stroke.bezierCurves = stroke.bezierCurves.map(curve => ({
                    ...curve,
                    p0: { ...curve.p0, x: curve.p0.x + dx, y: curve.p0.y + dy },
                    p1: { ...curve.p1, x: curve.p1.x + dx, y: curve.p1.y + dy },
                    p2: { ...curve.p2, x: curve.p2.x + dx, y: curve.p2.y + dy },
                    p3: { ...curve.p3, x: curve.p3.x + dx, y: curve.p3.y + dy }
                }));
            }
        });
    }

    public endDraggingSelection(): void {
        if (!this.isDragging) return;

        // Apply final changes to document
        this.selectedStrokes.forEach(strokeId => {
            const stroke = this.context.document?.getStroke(strokeId);
            if (stroke) {
                if (this.context.document)
                    this.context.document.updateStroke(strokeId, {
                        points: stroke.points,
                        bezierCurves: stroke.bezierCurves
                    });
            }
        });

        this.isDragging = false;
        this.dragStartPoint = null;
        this.dragOffset = { x: 0, y: 0 };
        this.originalStrokePositions.clear();

        this.context.saveDocument();
    }

    public copySelectedStrokes(): void {
        if (!this.context.document) return;

        this.copiedStrokes = [];
        this.selectedStrokes.forEach(strokeId => {
            const stroke = this.context.document?.getStroke(strokeId);
            if (stroke) {
                const copiedStroke: Stroke = {
                    ...stroke,
                    id: crypto.randomUUID(),
                    points: stroke.points.map(p => ({ ...p })),
                    bezierCurves: stroke.bezierCurves?.map(c => ({ ...c }))
                };
                this.copiedStrokes.push(copiedStroke);
            }
        });

        new Notice(`Copied ${this.copiedStrokes.length} stroke(s)`);
    }

    public pasteStrokes(blockIndex: number, offset: Point = { x: 10, y: 10 }): void {
        if (this.copiedStrokes.length === 0) return;

        const block = this.context.blocks[blockIndex];
        if (!block || !this.context.document) return;

        this.selectedStrokes.clear();

        const pastedStrokes: Stroke[] = [];

        this.copiedStrokes.forEach(originalStroke => {
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

            if (!this.context.document) return;
            const addedStroke = this.context.document.addStroke(newStroke);
            block.strokeIds.push(addedStroke.id);
            this.selectedStrokes.add(addedStroke.id);
            pastedStrokes.push(addedStroke);
        });

        if (pastedStrokes.length > 0) {
            this.context.historyManager?.push({
                type: 'PASTE_STROKES',
                blockId: block.id,
                strokes: pastedStrokes
            });
        }

        new Notice(`Pasted ${this.copiedStrokes.length} stroke(s)`);
        this.context.blockManager.renderBlocks();
    }

    public deleteSelectedStrokes(): void {
        if (this.selectedStrokes.size === 0 || !this.context.document) return;

        const count = this.selectedStrokes.size;
        const currentBlock = this.context.blocks[this.context.currentBlockIndex];

        if (currentBlock) {
            // History-Einträge VOR dem Löschen sammeln
            const entries: Array<{ blockId: string; stroke: Stroke; blockStrokeIdIndex: number }> = [];
            this.selectedStrokes.forEach(strokeId => {
                const idx = currentBlock.strokeIds.indexOf(strokeId);
                const stroke = this.context.document?.getStroke(strokeId);
                if (stroke && idx >= 0) {
                    entries.push({
                        blockId: currentBlock.id,
                        stroke: { ...stroke, points: stroke.points.map(p => ({ ...p })) },
                        blockStrokeIdIndex: idx
                    });
                }
            });

            currentBlock.strokeIds = currentBlock.strokeIds.filter(id => !this.selectedStrokes.has(id));

            this.selectedStrokes.forEach(strokeId => {
                this.context.document?.removeStroke(strokeId);
            });

            if (entries.length > 0) {
                this.context.historyManager?.push({ type: 'DELETE_STROKES', entries });
            }
        }

        this.selectedStrokes.clear();
        this.context.blockManager.renderBlocks();
        new Notice(`Deleted ${count} stroke(s)`);
    }

    public applyStyleToSelectedStrokes(style: Partial<StrokeStyle>): void {
    if (!this.context.document || this.selectedStrokes.size === 0) return;

    const currentBlock = this.context.blocks[this.context.currentBlockIndex];
    const historyEntries: Array<{ strokeId: string; oldStyle: StrokeStyle; newStyle: StrokeStyle }> = [];

    this.selectedStrokes.forEach(strokeId => {
        const stroke = this.context.document?.getStroke(strokeId);
        if (stroke) {
            const oldStyle: StrokeStyle = { ...stroke.style };
            const newStyle: StrokeStyle = { ...stroke.style, ...style };
            historyEntries.push({ strokeId, oldStyle, newStyle });
            this.context.document?.updateStroke(strokeId, { style: newStyle });
        }
    });

    if (historyEntries.length > 0 && currentBlock) {
        this.context.historyManager?.push({
            type: 'RESTYLE_STROKES',
            blockId: currentBlock.id,
            entries: historyEntries
        });
    }

    this.context.blockManager.renderBlocks();
    new Notice(`Updated style for ${this.selectedStrokes.size} stroke(s)`);
}

    public clearSelection(): void {
        this.selectedStrokes.clear();
        this.isSelecting = false;
        this.isDragging = false;
        this.context.blockManager.renderBlocks();
    }

    public getSelectedStrokesBoundingBox(): BoundingBox | null {
        if (this.selectedStrokes.size === 0 || !this.context.document) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasPoints = false;

        this.selectedStrokes.forEach(strokeId => {
            if (!this.context.document) return;
            const stroke = this.context.document.getStroke(strokeId);
            if (!stroke) return;

            for (const point of stroke.points) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
                hasPoints = true;
            }
        });

        if (!hasPoints) return null;

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    public isPointInSelection(point: Point): boolean {
        const bbox = this.getSelectedStrokesBoundingBox();
        if (!bbox) return false;

        return point.x >= bbox.x - 10 && point.x <= bbox.x + bbox.width + 10 &&
            point.y >= bbox.y - 10 && point.y <= bbox.y + bbox.height + 10;
    }

    public drawSelectionHighlights(canvas: HTMLCanvasElement, block: Block): void {
        if (!this.context.document || this.selectedStrokes.size === 0) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.save();
        ctx.strokeStyle = 'var(--interactive-accent)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);

        this.selectedStrokes.forEach(strokeId => {
            const stroke = this.context.document?.getStroke(strokeId);
            // Nur zeichnen, wenn der Strich zu diesem Block gehört
            if (!stroke || !block.strokeIds.includes(strokeId)) return;

            // Bounding Box des einzelnen Strichs berechnen
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const point of stroke.points) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }

            const padding = 3;
            ctx.strokeRect(
                minX - padding, minY - padding,
                maxX - minX + 2 * padding,
                maxY - minY + 2 * padding
            );
        });

        ctx.restore();
    }
}