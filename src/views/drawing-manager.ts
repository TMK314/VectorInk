import { Point, Stroke, StrokeStyle, Block, PartialBlock, BlockDisplaySettings } from '../types';
import { BezierCurveFitter, CubicBezier } from 'bezierFitting';
import { InkView } from './InkView';
import { Notice } from 'obsidian';

export class DrawingManager {
    private context: InkView;

    // Drawing state
    public isDrawing = false;
    public isErasing = false;
    public currentStroke: Point[] = [];
    public currentTool: 'pen' | 'eraser' | 'selection' = 'pen';
    public eraserMode: 'stroke' | 'point' = 'stroke';
    public currentPenStyle: StrokeStyle = {
        width: 2.0,
        color: '#000000',
        semantic: 'normal',
        opacity: 1.0
    };

    // Drawing settings
    public widthMultiplier = 1.0; // Default-Wert
    public pressureSensitivity = true;
    public smoothing = 0.3;
    public epsilon = 1.0;

    public dragOffset: Point = { x: 0, y: 0, t: 0, pressure: 0.5 };

    // Block height expansion
    private readonly BLOCK_EXPANSION_THRESHOLD = 50;
    private readonly BLOCK_EXPANSION_AMOUNT = 100;

    constructor(context: InkView) {
        this.context = context;
    }

    public setupCanvasEvents(canvas: HTMLCanvasElement, blockIndex: number): void {
        let lastPoint: Point | null = null;
        let lastErasePoint: Point | null = null;
        let isMouseDown = false;

        // Stroke selection variables
        let isSelectingRect = false;
        let selectionRectStart: Point | null = null;
        let selectionBox: HTMLElement | null = null;
        let isDraggingSelection = false;
        let dragStartPoint: Point | null = null;
        let originalStrokePositions = new Map<string, Point[]>();

        const getPoint = (e: MouseEvent | TouchEvent): Point | null => {
            const rect = canvas.getBoundingClientRect();
            let x, y;

            if ('touches' in e) {
                if (e.touches.length === 0) return null;
                const touch = e.touches[0];
                if (!touch) return null;
                x = touch.clientX - rect.left;
                y = touch.clientY - rect.top;
            } else {
                x = (e as MouseEvent).clientX - rect.left;
                y = (e as MouseEvent).clientY - rect.top;
            }

            return {
                x: x * (canvas.width / rect.width),
                y: y * (canvas.height / rect.height),
                t: Date.now(),
                pressure: 0.5
            };
        };

        // Helper function to get stroke at point
        const getStrokeAtPoint = (point: Point): string | null => {
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
        };

        // Check if point is on or near selection border
        const isPointOnSelectionBorder = (point: Point): boolean => {
            const bbox = this.context.strokeSelectionManager.getSelectedStrokesBoundingBox();
            if (!bbox) return false;

            const BORDER_TOLERANCE = 8; // How close to the border we need to be

            // Check left border
            if (Math.abs(point.x - bbox.x) <= BORDER_TOLERANCE &&
                point.y >= bbox.y && point.y <= bbox.y + bbox.height) {
                return true;
            }
            // Check right border
            if (Math.abs(point.x - (bbox.x + bbox.width)) <= BORDER_TOLERANCE &&
                point.y >= bbox.y && point.y <= bbox.y + bbox.height) {
                return true;
            }
            // Check top border
            if (Math.abs(point.y - bbox.y) <= BORDER_TOLERANCE &&
                point.x >= bbox.x && point.x <= bbox.x + bbox.width) {
                return true;
            }
            // Check bottom border
            if (Math.abs(point.y - (bbox.y + bbox.height)) <= BORDER_TOLERANCE &&
                point.x >= bbox.x && point.x <= bbox.x + bbox.width) {
                return true;
            }

            return false;
        };

        // Check if point is inside selection (not just on border)
        const isPointInsideSelection = (point: Point): boolean => {
            const bbox = this.context.strokeSelectionManager.getSelectedStrokesBoundingBox();
            if (!bbox) return false;

            return point.x >= bbox.x && point.x <= bbox.x + bbox.width &&
                point.y >= bbox.y && point.y <= bbox.y + bbox.height;
        };

        const getCanvasCursor = (point: Point): string => {
            const strokeId = getStrokeAtPoint(point);

            if (this.currentTool === 'selection') {
                if (strokeId && this.context.strokeSelectionManager.selectedStrokes.has(strokeId)) {
                    return 'move';
                }

                if (isPointOnSelectionBorder(point)) {
                    return 'move';
                }

                return 'crosshair';
            }

            return 'default';
        };

        const updateCursor = (point: Point) => {
            canvas.style.cursor = getCanvasCursor(point);
        };

        const startDrawing = (point: Point) => {
            if (blockIndex !== this.context.currentBlockIndex) return;

            this.isDrawing = true;
            this.currentStroke = [point];
            lastPoint = point;

            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.beginPath();
                ctx.moveTo(point.x, point.y);
            }
        };

        const draw = (point: Point) => {
            if (!this.isDrawing || blockIndex !== this.context.currentBlockIndex) return;

            const ctx = canvas.getContext('2d');
            if (!ctx || !lastPoint) return;

            this.currentStroke.push(point);

            ctx.beginPath();
            ctx.moveTo(lastPoint.x, lastPoint.y);
            ctx.lineTo(point.x, point.y);

            const currentBlock = this.context.blocks[this.context.currentBlockIndex];
            if (currentBlock) {
                const displayStyle = this.context.styleManager.getCalculatedStrokeStyle(
                    currentBlock.type,
                    this.currentPenStyle
                );

                ctx.strokeStyle = displayStyle.color;
                ctx.globalAlpha = displayStyle.opacity || 1;
                ctx.lineWidth = displayStyle.width;
            } else {
                ctx.strokeStyle = this.currentPenStyle.color;
                ctx.globalAlpha = this.currentPenStyle.opacity || 1;
                ctx.lineWidth = this.currentPenStyle.width;
            }

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            lastPoint = point;

            this.checkAutoExpand(canvas, point);
        };

        const stopDrawing = () => {
            if (!this.isDrawing || !this.context.document) return;

            this.isDrawing = false;
            if (this.currentStroke.length < 2) return;

            const block = this.context.blocks[this.context.currentBlockIndex];
            if (!block) return;

            const simplified = this.simplifyStroke(this.currentStroke, this.epsilon);
            const stroke: Stroke = {
                id: crypto.randomUUID(),
                points: simplified.points,
                bezierCurves: simplified.bezierCurves,
                style: { ...this.currentPenStyle },
                createdAt: new Date().toISOString()
            };

            const addedStroke = this.context.document.addStroke(stroke);
            block.strokeIds.push(addedStroke.id);

            this.updateBlockBoundingBox(block, simplified.points);
            this.syncBlockStrokes(block);

            this.currentStroke = [];
            lastPoint = null;

            if (simplified.bezierCurves.length > 0) {
                console.log(`✓ Stroke saved with ${simplified.bezierCurves.length} bezier curves ` +
                    `(${simplified.bezierCurves.length * 4} control points) ` +
                    `instead of ${this.currentStroke.length} raw points`);
            }
        };

        const startErasing = (point: Point) => {
            if (blockIndex !== this.context.currentBlockIndex) return;

            this.isErasing = true;
            lastErasePoint = point;

            this.eraseAtPoint(canvas, blockIndex, point);
        };

        const erase = (point: Point) => {
            if (!this.isErasing || blockIndex !== this.context.currentBlockIndex) return;

            if (lastErasePoint) {
                const distance = Math.sqrt(
                    Math.pow(point.x - lastErasePoint.x, 2) +
                    Math.pow(point.y - lastErasePoint.y, 2)
                );

                const steps = Math.max(1, Math.floor(distance / 5));

                for (let i = 1; i <= steps; i++) {
                    const t = i / steps;
                    const interpolatedPoint: Point = {
                        x: lastErasePoint.x + (point.x - lastErasePoint.x) * t,
                        y: lastErasePoint.y + (point.y - lastErasePoint.y) * t,
                        t: Date.now(),
                        pressure: 0.5
                    };

                    this.eraseAtPoint(canvas, blockIndex, interpolatedPoint);
                }
            } else {
                this.eraseAtPoint(canvas, blockIndex, point);
            }

            lastErasePoint = point;
        };

        const stopErasing = () => {
            this.isErasing = false;
            lastErasePoint = null;

            const block = this.context.blocks[blockIndex];
            if (block) {
                setTimeout(() => {
                    this.adjustBlockSize(block.id);
                }, 50);
            }
        };

        const startSelection = (point: Point, e: MouseEvent) => {
            const strokeId = getStrokeAtPoint(point);

            if (strokeId) {
                // Clicked on a stroke
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    // Add to selection with modifier key
                    this.context.strokeSelectionManager.toggleStrokeSelection(strokeId);
                } else {
                    if (this.context.strokeSelectionManager.selectedStrokes.has(strokeId)) {
                        // Start dragging selected strokes
                        startDraggingSelection(point);
                    } else {
                        // Select single stroke
                        this.context.strokeSelectionManager.selectedStrokes.clear();
                        this.context.strokeSelectionManager.selectedStrokes.add(strokeId);
                    }
                }
            } else if (isPointOnSelectionBorder(point) &&
                this.context.strokeSelectionManager.selectedStrokes.size > 0) {
                // Clicked on selection border - start dragging
                startDraggingSelection(point);
            } else if (isPointInsideSelection(point) &&
                this.context.strokeSelectionManager.selectedStrokes.size > 0) {
                // Clicked inside selection (but not on border) - also start dragging
                startDraggingSelection(point);
            } else {
                // Start rectangle selection
                isSelectingRect = true;
                selectionRectStart = point;

                // Create selection rectangle element
                selectionBox = document.createElement('div');
                selectionBox.className = 'stroke-selection-box';
                selectionBox.style.position = 'absolute';
                selectionBox.style.border = '2px dashed var(--interactive-accent)';
                selectionBox.style.background = 'rgba(var(--interactive-accent-rgb), 0.1)';
                selectionBox.style.pointerEvents = 'none';
                selectionBox.style.zIndex = '1000';

                const canvasRect = canvas.getBoundingClientRect();
                selectionBox.style.left = `${canvasRect.left}px`;
                selectionBox.style.top = `${canvasRect.top}px`;
                selectionBox.style.width = '0';
                selectionBox.style.height = '0';

                document.body.appendChild(selectionBox);
            }

            redrawCanvasWithSelection();
        };

        const updateSelectionRect = (point: Point) => {
            if (!isSelectingRect || !selectionRectStart || !selectionBox) return;

            const x = Math.min(selectionRectStart.x, point.x);
            const y = Math.min(selectionRectStart.y, point.y);
            const width = Math.abs(point.x - selectionRectStart.x);
            const height = Math.abs(point.y - selectionRectStart.y);

            const canvasRect = canvas.getBoundingClientRect();
            const scaleX = canvasRect.width / canvas.width;
            const scaleY = canvasRect.height / canvas.height;

            selectionBox.style.left = `${canvasRect.left + x * scaleX}px`;
            selectionBox.style.top = `${canvasRect.top + y * scaleY}px`;
            selectionBox.style.width = `${width * scaleX}px`;
            selectionBox.style.height = `${height * scaleY}px`;
        };

        const endSelectionRect = (endPoint: Point, addToSelection: boolean) => {
            if (!isSelectingRect || !selectionRectStart) return;

            const block = this.context.blocks[blockIndex];
            if (!block || !this.context.document) return;

            const x1 = Math.min(selectionRectStart.x, endPoint.x);
            const y1 = Math.min(selectionRectStart.y, endPoint.y);
            const x2 = Math.max(selectionRectStart.x, endPoint.x);
            const y2 = Math.max(selectionRectStart.y, endPoint.y);

            if (!addToSelection) {
                this.context.strokeSelectionManager.selectedStrokes.clear();
            }

            for (const strokeId of block.strokeIds) {
                const stroke = this.context.document.strokes.find(s => s.id === strokeId);
                if (!stroke) continue;

                for (const point of stroke.points) {
                    if (point.x >= x1 && point.x <= x2 && point.y >= y1 && point.y <= y2) {
                        this.context.strokeSelectionManager.selectedStrokes.add(strokeId);
                        break;
                    }
                }
            }

            // Clean up
            if (selectionBox) {
                selectionBox.remove();
                selectionBox = null;
            }
            isSelectingRect = false;
            selectionRectStart = null;

            redrawCanvasWithSelection();
        };

        const startDraggingSelection = (point: Point) => {
            const block = this.context.blocks[blockIndex];
            if (!block || !this.context.document) return;

            isDraggingSelection = true;
            dragStartPoint = point;
            originalStrokePositions.clear();

            // Store original positions for all selected strokes
            this.context.strokeSelectionManager.selectedStrokes.forEach(strokeId => {
                const stroke = this.context.document?.getStroke(strokeId);
                if (stroke) {
                    originalStrokePositions.set(strokeId, [...stroke.points]);
                }
            });

            // Show move cursor
            canvas.style.cursor = 'move';
        };

        const updateDraggingSelection = (point: Point) => {
            if (!isDraggingSelection || !dragStartPoint || !this.context.document) return;

            const dx = point.x - dragStartPoint.x;
            const dy = point.y - dragStartPoint.y;

            // Update strokes in memory (for preview)
            this.context.strokeSelectionManager.selectedStrokes.forEach(strokeId => {
                const originalPoints = originalStrokePositions.get(strokeId);
                if (!originalPoints) return;

                const stroke = this.context.document?.getStroke(strokeId);
                if (!stroke) return;

                // Temporarily update for preview
                stroke.points = originalPoints.map(p => ({
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
            });

            redrawCanvasWithSelection();
        };

        const endDraggingSelection = () => {
            if (!isDraggingSelection || !this.context.document) return;

            // Calculate final offset
            const dx = dragStartPoint ? this.dragOffset.x : 0;
            const dy = dragStartPoint ? this.dragOffset.y : 0;

            // Update document with final positions
            this.context.strokeSelectionManager.selectedStrokes.forEach(strokeId => {
                const originalPoints = originalStrokePositions.get(strokeId);
                if (!originalPoints) return;

                const stroke = this.context.document?.getStroke(strokeId);
                if (!stroke) return;

                // Set final position
                stroke.points = originalPoints.map(p => ({
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

                // Update in document
                if (this.context.document)
                    this.context.document.updateStroke(strokeId, {
                        points: stroke.points,
                        bezierCurves: stroke.bezierCurves
                    });
            });

            isDraggingSelection = false;
            dragStartPoint = null;
            originalStrokePositions.clear();

            // Update block size
            const block = this.context.blocks[blockIndex];
            if (block) {
                this.adjustBlockSize(block.id);
            }

            // Save document
            this.context.saveDocument();
            new Notice(`Moved ${this.context.strokeSelectionManager.selectedStrokes.size} stroke(s)`);
        };

        const redrawCanvasWithSelection = () => {
            const block = this.context.blocks[blockIndex];
            if (block) {
                this.drawBlockStrokes(canvas, block);
                drawSelectionHighlights(canvas, block);
            }
        };

        const drawSelectionHighlights = (canvas: HTMLCanvasElement, block: Block) => {
            if (!this.context.document || this.context.strokeSelectionManager.selectedStrokes.size === 0) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Draw bounding box around entire selection
            const bbox = this.context.strokeSelectionManager.getSelectedStrokesBoundingBox();
            if (bbox) {
                ctx.strokeStyle = 'var(--interactive-accent)';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 3]);

                const padding = 5;
                ctx.strokeRect(
                    bbox.x - padding, bbox.y - padding,
                    bbox.width + 2 * padding,
                    bbox.height + 2 * padding
                );

                ctx.setLineDash([]);

                // Draw grab handles on corners
                if (!isDraggingSelection) {
                    ctx.fillStyle = 'var(--interactive-accent)';
                    const handleSize = 8;

                    // Top-left
                    ctx.fillRect(
                        bbox.x - padding - handleSize / 2,
                        bbox.y - padding - handleSize / 2,
                        handleSize,
                        handleSize
                    );
                    // Top-right
                    ctx.fillRect(
                        bbox.x + bbox.width + padding - handleSize / 2,
                        bbox.y - padding - handleSize / 2,
                        handleSize,
                        handleSize
                    );
                    // Bottom-left
                    ctx.fillRect(
                        bbox.x - padding - handleSize / 2,
                        bbox.y + bbox.height + padding - handleSize / 2,
                        handleSize,
                        handleSize
                    );
                    // Bottom-right
                    ctx.fillRect(
                        bbox.x + bbox.width + padding - handleSize / 2,
                        bbox.y + bbox.height + padding - handleSize / 2,
                        handleSize,
                        handleSize
                    );
                }
            }
        };

        // Mouse events
        const handleMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return; // Nur linke Maustaste

            const point = getPoint(e);
            if (!point) return;

            isMouseDown = true;
            updateCursor(point);

            const block = this.context.blocks[blockIndex];

            if (!block) return;

            // Verwende direkt die Canvas-Koordinaten
            const blockX = point.x;
            const blockY = point.y;

            // Je nach Tool unterschiedlich handeln
            if (this.currentTool === 'selection') {
                startSelection(point, e);
            } else if (this.currentTool === 'eraser') {
                startErasing(point);
            } else if (this.currentTool === 'pen') {
                startDrawing(point);
                lastPoint = point;
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            const point = getPoint(e);
            if (!point) return;

            updateCursor(point);

            if (this.currentTool === 'selection') {
                if (isDraggingSelection) {
                    this.dragOffset = {
                        x: point.x - (dragStartPoint?.x || 0),
                        y: point.y - (dragStartPoint?.y || 0),
                        t: 0,
                        pressure: 0.5
                    };
                    updateDraggingSelection(point);
                } else if (isSelectingRect) {
                    updateSelectionRect(point);
                }
            } else if (this.currentTool === 'eraser' && this.isErasing) {
                erase(point);
            } else if (this.currentTool === 'pen' && this.isDrawing) {
                if (!lastPoint) {
                    lastPoint = point;
                    return;
                }

                draw(point);
                lastPoint = point;

                // Auto-Expand prüfen
                this.checkAutoExpand(canvas, point);
            }
        };

        const handleMouseUp = (e: MouseEvent) => {
            const point = getPoint(e);
            isMouseDown = false;

            if (this.currentTool === 'selection') {
                if (isSelectingRect && point) {
                    endSelectionRect(point, e.shiftKey || e.ctrlKey || e.metaKey);
                } else if (isDraggingSelection) {
                    endDraggingSelection();
                }
            } else if (this.currentTool === 'pen') {
                stopDrawing();
            } else if (this.currentTool === 'eraser') {
                stopErasing();
            }

            lastPoint = null;
            redrawCanvasWithSelection();
        };

        const handleMouseLeave = () => {
            canvas.style.cursor = 'default';

            if (isMouseDown) {
                handleMouseUp(new MouseEvent('mouseup'));
            }

            if (isSelectingRect && selectionBox) {
                selectionBox.remove();
                selectionBox = null;
                isSelectingRect = false;
                selectionRectStart = null;
            }
        };

        canvas.onmousedown = handleMouseDown;
        canvas.onmousemove = handleMouseMove;
        canvas.onmouseup = handleMouseUp;
        canvas.onmouseleave = handleMouseLeave;

        // Touch events
        const handleTouchStart = (e: TouchEvent) => {
            e.preventDefault();
            const point = getPoint(e);
            if (point) {
                if (this.currentTool === 'eraser') {
                    startErasing(point);
                } else if (this.currentTool === 'pen') {
                    startDrawing(point);
                    lastPoint = point;
                } else if (this.currentTool === 'selection') {
                    // For touch, treat as click selection
                    startSelection(point, new MouseEvent('mousedown'));
                }
            }
        };

        const handleTouchMove = (e: TouchEvent) => {
            e.preventDefault();
            const point = getPoint(e);
            if (point) {
                if (this.currentTool === 'eraser' && this.isErasing) {
                    erase(point);
                } else if (this.currentTool === 'pen' && this.isDrawing) {
                    if (!lastPoint) {
                        lastPoint = point;
                        return;
                    }
                    draw(point);
                    lastPoint = point;
                    this.checkAutoExpand(canvas, point);
                } else if (this.currentTool === 'selection') {
                    if (isDraggingSelection) {
                        updateDraggingSelection(point);
                    } else if (isSelectingRect) {
                        updateSelectionRect(point);
                    }
                }
            }
        };

        const handleTouchEnd = (e: TouchEvent) => {
            e.preventDefault();
            if (this.currentTool === 'selection') {
                if (isSelectingRect) {
                    const point = getPoint(e);
                    if (point) {
                        endSelectionRect(point, false);
                    }
                } else if (isDraggingSelection) {
                    endDraggingSelection();
                }
            } else if (this.currentTool === 'pen') {
                stopDrawing();
            } else if (this.currentTool === 'eraser') {
                stopErasing();
            }
            lastPoint = null;
        };

        // Event-Listener hinzufügen
        canvas.onmousedown = handleMouseDown;
        canvas.onmousemove = handleMouseMove;
        canvas.onmouseup = handleMouseUp;
        canvas.onmouseleave = handleMouseLeave;

        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
        canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

        // Verhindere Kontextmenü auf Canvas
        canvas.oncontextmenu = (e) => {
            e.preventDefault();
            return false;
        };
    }

    public getBlockDisplaySettings(block: Block): BlockDisplaySettings {
        const docGrid = this.context.document?.gridSettings ?? {
            enabled: false, type: 'grid' as const,
            size: 20, color: '#e0e0e0', opacity: 0.5, lineWidth: 0.5
        };
        return {
            grid: block.displaySettings?.grid ?? docGrid,
            useColor: block.displaySettings?.useColor ?? this.context.toolbarManager?.useColorForStyling ?? true,
            widthMultiplier: block.displaySettings?.widthMultiplier ?? this.widthMultiplier,
            backgroundColor: block.displaySettings?.backgroundColor ?? '#ffffff',
        };
    }

    public drawBlockStrokes(canvas: HTMLCanvasElement, block: Block): void {
        if (!this.context.document) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw background: theme-adaptiv bei useColor=false, sonst gespeicherte Block-Farbe
        const ds = this.getBlockDisplaySettings(block);
        const isDark = this.context.styleManager.isDarkTheme();
        const bgColor = !ds.useColor
            ? (getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || (isDark ? '#1a1a1a' : '#ffffff'))
            : (ds.backgroundColor ?? '#ffffff');
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw grid
        this.drawGrid(canvas, block);

        // Draw strokes
        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.strokes.find(s => s.id === strokeId);
            if (!stroke) continue;

            const displayStyle = this.context.styleManager.getCalculatedStrokeStyle(
                block.type, stroke.style, ds.useColor, ds.widthMultiplier
            );

            if (stroke.bezierCurves && stroke.bezierCurves.length > 0) {
                this.drawBezierStroke(ctx, stroke.bezierCurves, displayStyle);
            } else if (stroke.points.length >= 2) {
                this.drawLinearStroke(ctx, stroke.points, displayStyle);
            }
        }
    }

    private simplifyStroke(points: Point[], epsilon: number): { points: Point[], bezierCurves: CubicBezier[] } {
        console.log('simplifyStroke called with:', points.length, 'points, epsilon:', epsilon);

        if (points.length <= 2) {
            console.log('Too few points, returning original');
            return {
                points: points,
                bezierCurves: []
            };
        }

        const fitter = new BezierCurveFitter({
            epsilon: epsilon,
            minSegmentLength: 40,
            usePressure: this.pressureSensitivity
        });

        try {
            const bezierCurves = fitter.fitCurve(points);
            console.log('Generated', bezierCurves.length, 'bezier curves');

            const simplifiedPoints: Point[] = [];

            for (const bezier of bezierCurves) {
                simplifiedPoints.push(bezier.p0);
                simplifiedPoints.push(fitter.evaluateBezier(bezier, 0.5));

                if (bezierCurves.indexOf(bezier) === bezierCurves.length - 1) {
                    simplifiedPoints.push(bezier.p3);
                }
            }

            console.log('Reduced from', points.length, 'to', simplifiedPoints.length, 'points for bounding box');
            console.log('Storing', bezierCurves.length, 'bezier curves (each with 4 control points =',
                bezierCurves.length * 4, 'total stored points)');

            return {
                points: simplifiedPoints,
                bezierCurves: bezierCurves
            };

        } catch (error) {
            console.error('Bezier fitting error:', error);
            return {
                points: points,
                bezierCurves: []
            };
        }
    }

    private updateBlockBoundingBox(block: Block, points: Point[]): void {
        if (points.length === 0) return;

        const firstPoint = points[0];
        if (!firstPoint) return;

        let minX = firstPoint.x;
        let maxX = firstPoint.x;
        let minY = firstPoint.y;
        let maxY = firstPoint.y;

        for (const point of points) {
            if (!point) continue;
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }

        const padding = 10;
        block.bbox.x = Math.min(block.bbox.x, minX - padding);
        block.bbox.y = Math.min(block.bbox.y, minY - padding);
        block.bbox.width = Math.max(block.bbox.width, maxX - block.bbox.x + padding);
        block.bbox.height = Math.max(block.bbox.height, maxY - block.bbox.y + padding);
    }

    private checkAutoExpand(canvas: HTMLCanvasElement, point: Point): void {
        const block = this.context.blocks[this.context.currentBlockIndex];
        if (!block) return;

        if (this.isDrawing && this.currentTool === 'pen') {
            this.expandBlockIfNeeded(canvas, block, point);
        }
    }

    private expandBlockIfNeeded(canvas: HTMLCanvasElement, block: Block, point: Point): void {
        const padding = 30; // Weniger Padding für präzisere Kontrolle
        const threshold = 20; // Niedrigerer Schwellenwert

        // Prüfe nach unten
        if (point.y > block.bbox.height - threshold) {
            const additionalHeight = Math.max(
                50, // Mindesterweiterung
                point.y - block.bbox.height + padding
            );
            this.expandBlock(canvas, block, 'height', additionalHeight);
        }

        // Prüfe nach rechts (für drawing Blöcke)
        if ((block.type === 'drawing') &&
            point.x > block.bbox.width - threshold) {
            const additionalWidth = Math.max(
                50, // Mindesterweiterung
                point.x - block.bbox.width + padding
            );
            this.expandBlock(canvas, block, 'width', additionalWidth);
        }
    }

    private expandBlock(canvas: HTMLCanvasElement, block: Block, dimension: 'width' | 'height', amount: number): void {
        const oldWidth = block.bbox.width;
        const oldHeight = block.bbox.height;

        if (dimension === 'width') {
            block.bbox.width += amount;
        } else {
            block.bbox.height += amount;
        }

        // Canvas aktualisieren
        this.resizeCanvas(canvas, block);

        // Strokes neu zeichnen
        this.drawBlockStrokes(canvas, block);

        console.log(`Block expanded ${dimension}: ${dimension === 'width' ? `${oldWidth}->${block.bbox.width}` : `${oldHeight}->${block.bbox.height}`}`);
    }

    public resizeCanvas(canvas: HTMLCanvasElement, block: Block): void {
        const dpr = window.devicePixelRatio || 1;
        const oldWidth = canvas.width / dpr;
        const oldHeight = canvas.height / dpr;

        canvas.width = block.bbox.width * dpr;
        canvas.height = block.bbox.height * dpr;

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.scale(dpr, dpr);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
        }

        canvas.style.width = `${block.bbox.width}px`;
        canvas.style.height = `${block.bbox.height}px`;

        // Block-Element-Höhe anpassen
        const blockEl = canvas.closest('.ink-block') as HTMLElement;
        if (blockEl) {
            const isSelected = this.context.currentBlockIndex === this.context.blocks.findIndex(b => b.id === block.id);
            const extraHeight = isSelected ? 120 : 80;
            blockEl.style.minHeight = `${block.bbox.height + extraHeight}px`;
        }
    }

    public adjustBlockSizeAfterErasing(blockId: string): void {
        const block = this.context.blocks.find(b => b.id === blockId);
        if (!block || !this.context.document) return;

        const canvas = this.context.blockManager.getCanvasForBlock(blockId);
        if (!canvas) return;

        // Finde die äußersten Punkte der verbleibenden Striche
        let maxX = 0;
        let maxY = 0;
        let hasStrokes = false;

        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.strokes.find(s => s.id === strokeId);
            if (!stroke || stroke.points.length === 0) continue;

            hasStrokes = true;

            for (const point of stroke.points) {
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
        }

        if (!hasStrokes) {
            // Wenn keine Striche mehr, zurücksetzen auf Standardgröße
            block.bbox.width = 760;
            block.bbox.height = 200;
        } else {
            // Berechne benötigte Größe mit Padding
            const neededWidth = Math.max(maxX + 100, 760);
            const neededHeight = Math.max(maxY + 100, 200);
            // Reduziere nur wenn deutlich größer als benötigt (> 150px extra)
            if (block.bbox.width - neededWidth > 150) {
                block.bbox.width = neededWidth;
            }
            if (block.bbox.height - neededHeight > 150) {
                block.bbox.height = neededHeight;
            }
        }

        // Canvas aktualisieren
        this.resizeCanvas(canvas, block);
        this.drawBlockStrokes(canvas, block);
    }

    public updateBlockCanvasSize(block: Block, canvas: HTMLCanvasElement) {
        if (!this.context.document) return;

        const scrollBefore = this.context.blocksContainer?.scrollTop ?? 0;

        let maxY = 0;
        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.getStroke(strokeId);
            if (!stroke) continue;
            for (const p of stroke.points) maxY = Math.max(maxY, p.y);
        }

        const padding = 20;
        const newHeight = Math.max(150, maxY + padding);

        if (canvas.height !== newHeight || canvas.style.height !== `${newHeight}px`) {
            canvas.height = newHeight;
            canvas.style.height = `${newHeight}px`;
            block.bbox.height = newHeight;
            this.drawBlockStrokes(canvas, block);
        }

        if (this.context.blocksContainer) {
            this.context.blocksContainer.scrollTop = scrollBefore;
        }
    }

    private syncBlockStrokes(block: Block): void {
        if (!this.context.document) return;

        const allStrokeIds = block.strokeIds;
        const strokesToRemove: string[] = [];

        for (const stroke of this.context.document.strokes) {
            if (!allStrokeIds.includes(stroke.id)) {
                const firstPoint = stroke.points[0];
                if (firstPoint) {
                    if (firstPoint.x >= block.bbox.x &&
                        firstPoint.x <= block.bbox.x + block.bbox.width &&
                        firstPoint.y >= block.bbox.y &&
                        firstPoint.y <= block.bbox.y + block.bbox.height) {
                    }
                }
            }
        }
    }

    private eraseAtPoint(canvas: HTMLCanvasElement, blockIndex: number, point: Point): void {
        const block = this.context.blocks[blockIndex];
        if (!block || !this.context.document) return;

        const eraserRadius = this.currentPenStyle.width * 5;
        const strokeIdsToRemove: string[] = [];
        let strokesRemoved = false;

        if (this.eraserMode === 'stroke') {
            for (const strokeId of block.strokeIds) {
                const stroke = this.context.document.strokes.find(s => s.id === strokeId);
                if (!stroke) continue;

                let strokeRemoved = false;

                for (const p of stroke.points) {
                    const distance = Math.sqrt(
                        Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2)
                    );

                    if (distance <= eraserRadius) {
                        strokeIdsToRemove.push(strokeId);
                        strokeRemoved = true;
                        strokesRemoved = true;
                        break;
                    }
                }

                if (!strokeRemoved && stroke.points.length >= 2) {
                    for (let i = 0; i < stroke.points.length - 1; i++) {
                        const p1 = stroke.points[i];
                        const p2 = stroke.points[i + 1];

                        if (p1 && p2) {
                            const distanceToLine = this.distanceToLineSegment(point, p1, p2);
                            if (distanceToLine <= eraserRadius) {
                                strokeIdsToRemove.push(strokeId);
                                strokesRemoved = true;
                                break;
                            }
                        }
                    }
                }
            }
        } else {
            for (const strokeId of block.strokeIds) {
                const stroke = this.context.document.strokes.find(s => s.id === strokeId);
                if (!stroke) continue;

                for (const p of stroke.points) {
                    const distance = Math.sqrt(
                        Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2)
                    );

                    if (distance <= eraserRadius) {
                        strokeIdsToRemove.push(strokeId);
                        strokesRemoved = true;
                        break;
                    }
                }
            }
        }

        if (strokeIdsToRemove.length > 0) {
            const beforeCount = block.strokeIds.length;
            block.strokeIds = block.strokeIds.filter(id => !strokeIdsToRemove.includes(id));
            const removedCount = beforeCount - block.strokeIds.length;

            strokeIdsToRemove.forEach(strokeId => {
                this.context.document?.removeStroke(strokeId);
            });


            this.drawBlockStrokes(canvas, block);

            if (strokesRemoved) {
                setTimeout(() => {
                    // Block-Größe automatisch anpassen
                    this.adjustBlockSizeAfterErasing(block.id);
                }, 100);
            }
        }
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

    private calculateOptimalBlockSize(block: Block): { width: number, height: number } {
        if (!this.context.document) {
            return { width: block.bbox.width, height: block.bbox.height };
        }

        const isSelected = this.context.blocks.findIndex(b => b.id === block.id) === this.context.currentBlockIndex;

        const MIN_WIDTH = 760;
        const MIN_HEIGHT_SELECTED = 200;
        const MIN_HEIGHT_UNSELECTED = 150;
        const MIN_HEIGHT = isSelected ? MIN_HEIGHT_SELECTED : MIN_HEIGHT_UNSELECTED;

        if (block.strokeIds.length === 0) {
            return {
                width: MIN_WIDTH,
                height: MIN_HEIGHT
            };
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let hasStrokes = false;

        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.strokes.find(s => s.id === strokeId);
            if (!stroke || stroke.points.length === 0) continue;

            hasStrokes = true;

            for (const point of stroke.points) {
                minX = Math.min(minX, point.x);
                maxX = Math.max(maxX, point.x);
                minY = Math.min(minY, point.y);
                maxY = Math.max(maxY, point.y);
            }
        }

        if (!hasStrokes || minX === Infinity || maxX === -Infinity || minY === Infinity || maxY === -Infinity) {
            return {
                width: MIN_WIDTH,
                height: MIN_HEIGHT
            };
        }

        const horizontalPadding = 80;
        const verticalPadding = 60;

        let calculatedWidth = maxX - minX + horizontalPadding;
        let calculatedHeight = maxY - minY + verticalPadding;

        calculatedWidth = Math.max(MIN_WIDTH, calculatedWidth);
        calculatedHeight = Math.max(MIN_HEIGHT, calculatedHeight);

        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 800;
        calculatedWidth = Math.min(MAX_WIDTH, calculatedWidth);
        calculatedHeight = Math.min(MAX_HEIGHT, calculatedHeight);

        const currentHeight = block.bbox.height;
        const shrinkThreshold = 80;

        if (currentHeight - calculatedHeight > shrinkThreshold) {
            return {
                width: calculatedWidth,
                height: calculatedHeight
            };
        } else {
            return {
                width: Math.max(block.bbox.width, MIN_WIDTH),
                height: Math.max(block.bbox.height, MIN_HEIGHT)
            };
        }
    }

    public adjustBlockSize(blockId: string): void {
        const blockIndex = this.context.blocks.findIndex(b => b.id === blockId);
        if (blockIndex === -1) return;

        const block = this.context.blocks[blockIndex];
        const canvas = this.context.blockManager.getCanvasForBlock(blockId);

        if (!block || !canvas) return;

        // Für andere Blöcke: Bestehende Logik
        const optimalSize = this.calculateOptimalBlockSize(block);

        // Nur ändern, wenn Unterschied signifikant (> 50px)
        const widthDiff = Math.abs(block.bbox.width - optimalSize.width);
        const heightDiff = Math.abs(block.bbox.height - optimalSize.height);

        if (widthDiff > 50 || heightDiff > 50) {
            block.bbox.width = optimalSize.width;
            block.bbox.height = optimalSize.height;
            this.resizeCanvas(canvas, block);
            this.drawBlockStrokes(canvas, block);
        }
    }

    private drawBezierStroke(
        ctx: CanvasRenderingContext2D,
        bezierCurves: CubicBezier[],
        displayStyle: StrokeStyle
    ): void {
        if (bezierCurves.length === 0) return;

        ctx.strokeStyle = displayStyle.color;
        ctx.globalAlpha = displayStyle.opacity || 1;
        ctx.lineWidth = displayStyle.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (const bezier of bezierCurves) {
            ctx.beginPath();
            ctx.moveTo(bezier.p0.x, bezier.p0.y);
            ctx.bezierCurveTo(
                bezier.p1.x, bezier.p1.y,
                bezier.p2.x, bezier.p2.y,
                bezier.p3.x, bezier.p3.y
            );
            ctx.stroke();
        }
    }

    private drawLinearStroke(
        ctx: CanvasRenderingContext2D,
        points: Point[],
        displayStyle: StrokeStyle
    ): void {
        if (points.length < 2) return;

        ctx.strokeStyle = displayStyle.color;
        ctx.globalAlpha = displayStyle.opacity || 1;
        ctx.lineWidth = displayStyle.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        if (points[0]) {
            ctx.moveTo(points[0].x, points[0].y);

            for (let i = 1; i < points.length; i++) {
                const point = points[i];
                if (point) {
                    ctx.lineTo(point.x, point.y);
                }
            }

            ctx.stroke();
        }
    }

    public setTool(tool: 'pen' | 'eraser' | 'selection'): void {
        this.currentTool = tool;

        if (tool !== 'pen') {
            this.isDrawing = false;
            this.currentStroke = [];
        }
        if (tool !== 'eraser') {
            this.isErasing = false;
        }

        new Notice(`Tool set to: ${tool}`);
    }

    public updateBlock(updates: PartialBlock): void {
        const index = this.context.blocks.findIndex(b => b.id === updates.id);
        if (index >= 0) {
            const block = this.context.blocks[index];
            if (block) {
                Object.assign(block, updates);

                if (this.context.document) {
                    const docBlock = this.context.document.getBlock(block.id);
                    if (docBlock) {
                        this.context.document.updateBlock(block.id, block);
                    } else {
                        this.context.document.addBlock(block);
                    }
                }
            }
        }
    }

    public redrawAllBlocks(): void {
        if (!this.context.blocksContainer) return;

        const canvases = this.context.blocksContainer.querySelectorAll('canvas');
        canvases.forEach(canvas => {
            const blockId = canvas.closest('.ink-block')?.getAttribute('data-block-id');
            if (blockId) {
                const block = this.context.blocks.find(b => b.id === blockId);
                if (block) {
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);

                        const isDark = this.context.styleManager.isDarkTheme();
                        const ds = this.getBlockDisplaySettings(block);
                        const bgColor = ds.useColor
                            ? (getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || (isDark ? '#1a1a1a' : '#ffffff'))
                            : (ds.backgroundColor ?? '#ffffff');
                        ctx.fillStyle = bgColor;
                        ctx.fillRect(0, 0, canvas.width, canvas.height);

                        this.drawBlockStrokes(canvas, block);
                    }
                }
            }
        });
    }

    // Grid Patern ----------------------------
    private drawGrid(canvas: HTMLCanvasElement, block: Block): void {
        const ds = this.getBlockDisplaySettings(block);
        const grid = ds.grid;
        if (!grid.enabled) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const isDark = this.context.styleManager.isDarkTheme();

        // Grid-Farbe: gespeicherte Farbe wenn useColor==true, sonst Theme-Farbe
        const gridColor = ds.useColor
            ? grid.color
            : (isDark ? '#555555' : '#d0d0d0');

        ctx.save();
        ctx.globalAlpha = grid.opacity;
        ctx.strokeStyle = gridColor;
        ctx.fillStyle = gridColor;
        ctx.lineWidth = grid.lineWidth ?? 0.5;

        const size = grid.size;
        const width = canvas.width;
        const height = canvas.height;

        switch (grid.type) {
            case 'grid':
                this.drawGridPattern(ctx, width, height, size);
                break;
            case 'lines':
                this.drawLinePattern(ctx, width, height, size);
                break;
            case 'dots':
                this.drawDotPattern(ctx, width, height, size);
                break;
        }

        ctx.restore();
    }

    private drawGridPattern(ctx: CanvasRenderingContext2D, width: number, height: number, size: number): void {
        // Vertikale Linien
        for (let x = 0; x <= width; x += size) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // Horizontale Linien
        for (let y = 0; y <= height; y += size) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    }

    private drawLinePattern(ctx: CanvasRenderingContext2D, width: number, height: number, size: number): void {
        // Nur horizontale Linien (wie liniertes Papier)
        for (let y = 0; y <= height; y += size) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Optional: Eine dicke Linie alle 5 Zeilen (wie College-Block)
        for (let y = size * 5; y <= height; y += size * 5) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.lineWidth = 1;
        }
    }

    private drawDotPattern(ctx: CanvasRenderingContext2D, width: number, height: number, size: number): void {
        // Punkte an den Gitter-Schnittstellen
        for (let x = 0; x <= width; x += size) {
            for (let y = 0; y <= height; y += size) {
                ctx.beginPath();
                ctx.arc(x, y, 1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}