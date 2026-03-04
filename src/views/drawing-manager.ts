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
    public smoothing = 0.3;
    public epsilon = 1.0;

    private _rafPending = false;
    private _rafCanvas: HTMLCanvasElement | null = null;
    private _rafBlock: Block | null = null;
    private _eraseRafPending = false;
    private _eraseRafCanvas: HTMLCanvasElement | null = null;
    private _eraseRafBlock: Block | null = null;

    public dragOffset: Point = { x: 0, y: 0 };

    private _strokeCache = new Map<string, HTMLCanvasElement>();
    private _currentDrawStyle: ReturnType<typeof this.context.styleManager.getCalculatedStrokeStyle> | null = null;

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
        let originalStrokeData = new Map<string, { points: Point[], bezierCurves?: CubicBezier[] }>();

        let lastKnownPressure = 0.5;

        const getPoint = (e: PointerEvent): Point => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) * (canvas.width / rect.width),
                y: (e.clientY - rect.top) * (canvas.height / rect.height),
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

            // Style einmalig cachen für die gesamte Stroke-Dauer
            const currentBlock = this.context.blocks[this.context.currentBlockIndex];
            if (currentBlock) {
                this._currentDrawStyle = this.context.styleManager.getCalculatedStrokeStyle(
                    currentBlock.type,
                    this.currentPenStyle
                );
            } else {
                this._currentDrawStyle = null;
            }

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

            const style = this._currentDrawStyle ?? this.currentPenStyle;
            ctx.strokeStyle = style.color;
            ctx.globalAlpha = style.opacity ?? 1;
            ctx.lineWidth = style.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            lastPoint = point;
            this.checkAutoExpand(canvas, point);
        };

        const stopDrawing = () => {
            if (!this.isDrawing || !this.context.document) return;

            this.isDrawing = false;
            const block = this.context.blocks[this.context.currentBlockIndex];
            if (!block) return;

            if (this.currentStroke.length === 0) return;

            const originalCount = this.currentStroke.length;

            if (this.currentStroke.length === 1) {
                const p = this.currentStroke[0]!;
                const dot: Stroke = {
                    id: crypto.randomUUID(),
                    points: [p, { x: p.x + 0.1, y: p.y }],
                    bezierCurves: [],
                    style: { ...this.currentPenStyle },
                };
                const added = this.context.document.addStroke(dot);
                block.strokeIds.push(added.id);
                this.updateBlockBoundingBox(block, dot.points);
                this.currentStroke = [];
                lastPoint = null;
                console.log(`Stroke: ${originalCount} → 2 points (dot)`);
                this._appendStrokeToCache(block, added);
                return;
            }

            const simplified = this.simplifyStroke(this.currentStroke, this.epsilon);
            const finalCount = simplified.bezierCurves.length > 0
                ? simplified.bezierCurves.length * 4
                : simplified.points.length;
            console.log(`Stroke: ${originalCount} raw points → ${finalCount} stored points (${simplified.bezierCurves.length} bezier curves)`);

            const stroke: Stroke = {
                id: crypto.randomUUID(),
                points: simplified.points,
                bezierCurves: simplified.bezierCurves,
                style: { ...this.currentPenStyle },
            };

            const addedStroke = this.context.document.addStroke(stroke);
            block.strokeIds.push(addedStroke.id);
            this.updateBlockBoundingBox(block, simplified.points);
            this.syncBlockStrokes(block);
            this.currentStroke = [];
            lastPoint = null;
            // Cache NICHT invalidieren — neuen Stroke inkrementell draufzeichnen
            this._appendStrokeToCache(block, addedStroke);
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
                // Jetzt einmalig Cache invalidieren und neu aufbauen
                this.invalidateBlockCache(block.id);
                const canvas = this.context.blockManager.getCanvasForBlock(block.id);
                if (canvas) this.drawBlockStrokes(canvas, block);

                setTimeout(() => {
                    this.adjustBlockSize(block.id);
                }, 50);
            }
        };

        const startSelection = (point: Point, e: MouseEvent) => {
            const strokeId = getStrokeAtPoint(point);

            if (strokeId) {
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    this.context.strokeSelectionManager.toggleStrokeSelection(strokeId);
                    redrawCanvasWithSelection(); // <-- sofort
                } else {
                    if (this.context.strokeSelectionManager.selectedStrokes.has(strokeId)) {
                        startDraggingSelection(point);
                    } else {
                        this.context.strokeSelectionManager.selectedStrokes.clear();
                        this.context.strokeSelectionManager.selectedStrokes.add(strokeId);
                        redrawCanvasWithSelection(); // <-- sofort
                    }
                }
            } else if (isPointOnSelectionBorder(point) &&
                this.context.strokeSelectionManager.selectedStrokes.size > 0) {
                startDraggingSelection(point);
            } else if (isPointInsideSelection(point) &&
                this.context.strokeSelectionManager.selectedStrokes.size > 0) {
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
            originalStrokeData.clear();

            this.context.strokeSelectionManager.selectedStrokes.forEach(strokeId => {
                const stroke = this.context.document?.getStroke(strokeId);
                if (stroke) {
                    originalStrokeData.set(strokeId, {
                        points: stroke.points.map(p => ({ ...p })),
                        bezierCurves: stroke.bezierCurves ? stroke.bezierCurves.map(c => ({ ...c })) : undefined
                    });
                }
            });

            canvas.style.cursor = 'move';
        };

        const updateDraggingSelection = (point: Point) => {
            if (!isDraggingSelection || !dragStartPoint || !this.context.document) return;

            const block = this.context.blocks[blockIndex]; // blockIndex ist bereits im Closure vorhanden
            if (block) this.invalidateBlockCache(block.id); // <-- NEU

            const dx = point.x - dragStartPoint.x;
            const dy = point.y - dragStartPoint.y;

            this.context.strokeSelectionManager.selectedStrokes.forEach(strokeId => {
                const original = originalStrokeData.get(strokeId);
                if (!original) return;

                const stroke = this.context.document?.getStroke(strokeId);
                if (!stroke) return;

                // Punkte aus den Originaldaten verschieben
                stroke.points = original.points.map(p => ({
                    ...p,
                    x: p.x + dx,
                    y: p.y + dy
                }));

                // Bézier-Kurven aus den Originaldaten verschieben
                if (original.bezierCurves) {
                    stroke.bezierCurves = original.bezierCurves.map(curve => ({
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

            // Endgültige Positionen im Dokument speichern
            this.context.strokeSelectionManager.selectedStrokes.forEach(strokeId => {
                const stroke = this.context.document?.getStroke(strokeId);
                if (stroke) {
                    this.context.document?.updateStroke(strokeId, {
                        points: stroke.points,
                        bezierCurves: stroke.bezierCurves
                    });
                }
            });

            isDraggingSelection = false;
            dragStartPoint = null;
            originalStrokeData.clear();

            const block = this.context.blocks[blockIndex];
            if (block) {
                this.adjustBlockSize(block.id);
            }

            this.context.saveDocument();
            new Notice(`Moved ${this.context.strokeSelectionManager.selectedStrokes.size} stroke(s)`);
        };

        const redrawCanvasWithSelection = () => {
            const block = this.context.blocks[blockIndex];
            if (block) {
                this.drawBlockStrokes(canvas, block);
            }
        };

        // Mouse events
        const handlePointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            e.preventDefault();
            canvas.setPointerCapture(e.pointerId); // wichtig für reibungslosen Drag
            const point = getPoint(e);
            isMouseDown = true;
            updateCursor(point);
            const block = this.context.blocks[blockIndex];
            if (!block) return;
            if (this.currentTool === 'selection') {
                startSelection(point, e as unknown as MouseEvent);
            } else if (this.currentTool === 'eraser') {
                startErasing(point);
            } else if (this.currentTool === 'pen') {
                startDrawing(point);
                lastPoint = point;
            }
        };

        const handlePointerMove = (e: PointerEvent) => {
            const point = getPoint(e);
            // Cursor-Update nur im Ruhezustand (kostspielig: iteriert alle Strokes)
            if (!this.isDrawing && !this.isErasing) {
                updateCursor(point);
            }
            if (this.currentTool === 'selection') {
                if (isDraggingSelection) {
                    this.dragOffset = { x: point.x - (dragStartPoint?.x || 0), y: point.y - (dragStartPoint?.y || 0) };
                    updateDraggingSelection(point);
                } else if (isSelectingRect) {
                    updateSelectionRect(point);
                }
            } else if (this.currentTool === 'eraser' && this.isErasing) {
                erase(point);
            } else if (this.currentTool === 'pen' && this.isDrawing) {
                if (!lastPoint) { lastPoint = point; return; }
                draw(point);
                lastPoint = point;
                this.checkAutoExpand(canvas, point);
            }
        };

        const handlePointerUp = (e: PointerEvent) => {
            const point = getPoint(e);
            canvas.releasePointerCapture(e.pointerId);
            isMouseDown = false;

            if (this.currentTool === 'selection') {
                if (isSelectingRect) endSelectionRect(point, e.shiftKey || e.ctrlKey || e.metaKey);
                else if (isDraggingSelection) endDraggingSelection();
                redrawCanvasWithSelection(); // nur bei Selection nötig
            } else if (this.currentTool === 'pen') {
                stopDrawing();
                // KEIN redrawCanvasWithSelection — _appendStrokeToCache hat den Stroke bereits hinzugefügt
            } else if (this.currentTool === 'eraser') {
                stopErasing();
                redrawCanvasWithSelection();
            }

            lastPoint = null;
        };

        const handlePointerLeave = () => {
            canvas.style.cursor = 'default';
            if (isMouseDown) handlePointerUp(new PointerEvent('pointerup'));
            if (isSelectingRect && selectionBox) {
                selectionBox.remove(); selectionBox = null;
                isSelectingRect = false; selectionRectStart = null;
            }
        };

        // Pointer Events (vereinheitlicht Mouse + Touch + Stylus)
        canvas.style.touchAction = 'none'; // verhindert Browser-Scroll-Interferenz
        canvas.addEventListener('pointerdown', handlePointerDown);
        canvas.addEventListener('pointermove', handlePointerMove);
        canvas.addEventListener('pointerup', handlePointerUp);
        canvas.addEventListener('pointerleave', handlePointerLeave);

        // Touch-Events NICHT mehr separat nötig — PointerEvent deckt alles ab

        canvas.oncontextmenu = (e) => { e.preventDefault(); return false; };
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
        // RAF auch bei laufendem Stroke-Input (nicht nur isDrawing)
        if (this.isDrawing || this._rafPending) {
            this._rafCanvas = canvas;
            this._rafBlock = block;
            if (!this._rafPending) {
                this._rafPending = true;
                this._perf.rafExecuted++;
                requestAnimationFrame(() => {
                    this._rafPending = false;
                    if (this._rafCanvas && this._rafBlock)
                        this._drawBlockStrokesImmediate(this._rafCanvas, this._rafBlock);
                    this._perf.report();
                });
            } else {
                this._perf.rafSkipped++;
            }
            return;
        }
        this._drawBlockStrokesImmediate(canvas, block);
        this._perf.report();
    }

    private _drawBlockStrokesImmediate(canvas: HTMLCanvasElement, block: Block): void {
        if (!this.context.document) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const t0 = this._perf.beginDraw(block.strokeIds.length);
        const ds = this.getBlockDisplaySettings(block);
        const isDark = this.context.styleManager.isDarkTheme();
        const bgColor = ds.useColor
            ? (ds.backgroundColor ?? '#ffffff')
            : (getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || (isDark ? '#1a1a1a' : '#ffffff'))

        let cache = this._strokeCache.get(block.id);
        const needsRebuild = !cache
            || cache.width !== canvas.width
            || cache.height !== canvas.height;

        if (needsRebuild) {
            cache = document.createElement('canvas');
            cache.width = canvas.width;
            cache.height = canvas.height;
            this._strokeCache.set(block.id, cache);
            this._renderStrokesToCache(cache, block, ds, bgColor, isDark);
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (cache)
            ctx.drawImage(cache, 0, 0);

        if (this.isDrawing && this.currentStroke.length >= 2) {
            const currentBlock = this.context.blocks[this.context.currentBlockIndex];
            if (currentBlock?.id === block.id) {
                const displayStyle = this.context.styleManager.getCalculatedStrokeStyle(
                    block.type, this.currentPenStyle
                );
                this.drawLinearStroke(ctx, this.currentStroke, displayStyle);
            }
        }

        this.context.strokeSelectionManager.drawSelectionHighlights(canvas, block);
        this._perf.endDraw(t0);
        this._perf.report();
    }

    private simplifyStroke(points: Point[], epsilon: number): { points: Point[], bezierCurves: CubicBezier[] } {
        if (points.length <= 2) {
            return { points, bezierCurves: [] };
        }

        const fitter = new BezierCurveFitter({
            epsilon: epsilon,
            minSegmentLength: 50,
        });

        try {
            const bezierCurves = fitter.fitCurve(points);
            const simplifiedPoints: Point[] = [];
            for (const bezier of bezierCurves) {
                simplifiedPoints.push(bezier.p0);
                simplifiedPoints.push(fitter.evaluateBezier(bezier, 0.5));
                if (bezierCurves.indexOf(bezier) === bezierCurves.length - 1) {
                    simplifiedPoints.push(bezier.p3);
                }
            }
            return { points: simplifiedPoints, bezierCurves };
        } catch (error) {
            return { points, bezierCurves: [] };
        }
    }

    private _renderStrokesToCache(
        cache: HTMLCanvasElement,
        block: Block,
        ds: BlockDisplaySettings,
        bgColor: string,
        isDark: boolean
    ): void {
        // TEMP DEBUG — zeigt wer den Rebuild auslöst
        console.trace(`[InkPerf] Cache REBUILD — ${block.strokeIds.length} strokes`);

        if (!this.context.document) return;
        const ctx = cache.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, cache.width, cache.height);
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, cache.width, cache.height);

        this.drawGrid(cache, block);

        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.getStroke(strokeId);
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

    public invalidateBlockCache(blockId: string): void {
        this._strokeCache.delete(blockId);
    }

    private _appendStrokeToCache(block: Block, stroke: Stroke): void {
        const cache = this._strokeCache.get(block.id);
        if (!cache) return; // kein Cache vorhanden → wird beim nächsten Draw neu gebaut

        const ctx = cache.getContext('2d');
        if (!ctx) return;

        const ds = this.getBlockDisplaySettings(block);
        const displayStyle = this.context.styleManager.getCalculatedStrokeStyle(
            block.type, stroke.style, ds.useColor, ds.widthMultiplier
        );

        if (stroke.bezierCurves && stroke.bezierCurves.length > 0) {
            this.drawBezierStroke(ctx, stroke.bezierCurves, displayStyle);
        } else if (stroke.points.length >= 2) {
            this.drawLinearStroke(ctx, stroke.points, displayStyle);
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
        if (dimension === 'width') {
            block.bbox.width += amount;
        } else {
            block.bbox.height += amount;
        }

        const dpr = window.devicePixelRatio || 1;
        const newW = block.bbox.width * dpr;
        const newH = block.bbox.height * dpr;

        // Cache in neuer Größe aufbauen, alten Inhalt kopieren
        const oldCache = this._strokeCache.get(block.id);
        const newCache = document.createElement('canvas');
        newCache.width = newW;
        newCache.height = newH;
        const cCtx = newCache.getContext('2d');
        if (cCtx) {
            const ds = this.getBlockDisplaySettings(block);
            const isDark = this.context.styleManager.isDarkTheme();
            const bgColor = ds.useColor
                ? (getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || (isDark ? '#1a1a1a' : '#ffffff'))
                : (ds.backgroundColor ?? '#ffffff');
            cCtx.fillStyle = bgColor;
            cCtx.fillRect(0, 0, newW, newH);
            if (oldCache) cCtx.drawImage(oldCache, 0, 0);
        }
        this._strokeCache.set(block.id, newCache);

        // Canvas vergrößern — resetting canvas.width löscht Context-State, daher neu aufsetzen
        canvas.width = newW;
        canvas.height = newH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.scale(dpr, dpr);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            // Sofort den Cache aufmalen, damit bisherige Strokes während des Zeichnens sichtbar bleiben
            ctx.drawImage(newCache, 0, 0);
        }

        canvas.style.width = `${block.bbox.width}px`;
        canvas.style.height = `${block.bbox.height}px`;

        const blockEl = canvas.closest('.ink-block') as HTMLElement;
        if (blockEl) {
            const isSelected = this.context.currentBlockIndex === this.context.blocks.findIndex(b => b.id === block.id);
            blockEl.style.minHeight = `${block.bbox.height + (isSelected ? 120 : 80)}px`;
        }
    }

    public resizeCanvas(canvas: HTMLCanvasElement, block: Block): void {
        const dpr = window.devicePixelRatio || 1;

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

        const blockEl = canvas.closest('.ink-block') as HTMLElement;
        if (blockEl) {
            const isSelected = this.context.currentBlockIndex === this.context.blocks.findIndex(b => b.id === block.id);
            const extraHeight = isSelected ? 120 : 80;
            blockEl.style.minHeight = `${block.bbox.height + extraHeight}px`;
        }

        this.invalidateBlockCache(block.id);
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

        if (this.eraserMode === 'stroke') {
            for (const strokeId of block.strokeIds) {
                const stroke = this.context.document.getStroke(strokeId);
                if (!stroke) continue;

                let hit = false;
                for (const p of stroke.points) {
                    if (Math.hypot(p.x - point.x, p.y - point.y) <= eraserRadius) {
                        hit = true; break;
                    }
                }
                if (!hit && stroke.points.length >= 2) {
                    for (let i = 0; i < stroke.points.length - 1; i++) {
                        const p1 = stroke.points[i];
                        const p2 = stroke.points[i + 1];
                        if (p1 && p2 && this.distanceToLineSegment(point, p1, p2) <= eraserRadius) {
                            hit = true; break;
                        }
                    }
                }
                if (hit) strokeIdsToRemove.push(strokeId);
            }
        } else {
            for (const strokeId of block.strokeIds) {
                const stroke = this.context.document.getStroke(strokeId);
                if (!stroke) continue;
                for (const p of stroke.points) {
                    if (Math.hypot(p.x - point.x, p.y - point.y) <= eraserRadius) {
                        strokeIdsToRemove.push(strokeId); break;
                    }
                }
            }
        }

        if (strokeIdsToRemove.length === 0) return;

        block.strokeIds = block.strokeIds.filter(id => !strokeIdsToRemove.includes(id));
        strokeIdsToRemove.forEach(id => this.context.document?.removeStroke(id));

        // Cache invalidieren damit der nächste Frame den korrekten Zustand zeigt
        this.invalidateBlockCache(block.id);

        // Redraw via RAF — maximal 1 Rebuild pro Frame, egal wie viele Strokes gelöscht werden
        if (!this._eraseRafPending) {
            this._eraseRafPending = true;
            this._eraseRafCanvas = canvas;
            this._eraseRafBlock = block;
            requestAnimationFrame(() => {
                this._eraseRafPending = false;
                if (this._eraseRafCanvas && this._eraseRafBlock) {
                    this._drawBlockStrokesImmediate(this._eraseRafCanvas, this._eraseRafBlock);
                }
            });
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

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = displayStyle.color;
        ctx.globalAlpha = displayStyle.opacity ?? 1;

        ctx.lineWidth = displayStyle.width;
        ctx.beginPath();
        ctx.moveTo(bezierCurves[0]!.p0.x, bezierCurves[0]!.p0.y);
        for (const b of bezierCurves)
            ctx.bezierCurveTo(b.p1.x, b.p1.y, b.p2.x, b.p2.y, b.p3.x, b.p3.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        return;
    }

    private drawLinearStroke(
        ctx: CanvasRenderingContext2D,
        points: Point[],
        displayStyle: StrokeStyle
    ): void {
        if (points.length < 2) return;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = displayStyle.color;
        ctx.globalAlpha = displayStyle.opacity ?? 1;

        ctx.lineWidth = displayStyle.width;
        ctx.beginPath();
        ctx.moveTo(points[0]!.x, points[0]!.y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
        ctx.stroke();

        ctx.globalAlpha = 1;
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
            if (!blockId) return;
            const block = this.context.blocks.find(b => b.id === blockId);
            if (!block) return;

            // Cache invalidieren — erzwingt vollständigen Rebuild mit neuen Farben
            this.invalidateBlockCache(blockId);
            this._drawBlockStrokesImmediate(canvas as HTMLCanvasElement, block);
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

    /** DEbug
     * ----------------------------------
     */
    private _perf = {
        frameCount: 0,
        drawCallsThisFrame: 0,
        lastReport: 0,
        drawDurations: [] as number[],
        strokeCounts: [] as number[],
        rafSkipped: 0,
        rafExecuted: 0,

        /** Aufruf am Anfang jedes _drawBlockStrokesImmediate */
        beginDraw(strokeCount: number) {
            this.drawCallsThisFrame++;
            this.strokeCounts.push(strokeCount);
            return performance.now();
        },

        /** Aufruf am Ende von _drawBlockStrokesImmediate */
        endDraw(start: number) {
            this.drawDurations.push(performance.now() - start);
        },

        /** Jede Sekunde einen Report loggen */
        report() {
            const now = performance.now();
            if (now - this.lastReport < 1000) return;
            this.lastReport = now;

            const avgDraw = this.drawDurations.length
                ? (this.drawDurations.reduce((a, b) => a + b, 0) / this.drawDurations.length).toFixed(2)
                : '—';
            const maxDraw = this.drawDurations.length
                ? Math.max(...this.drawDurations).toFixed(2)
                : '—';
            const avgStrokes = this.strokeCounts.length
                ? (this.strokeCounts.reduce((a, b) => a + b, 0) / this.strokeCounts.length).toFixed(1)
                : '—';
            const maxStrokes = this.strokeCounts.length
                ? Math.max(...this.strokeCounts)
                : '—';

            console.group('%c[InkPerf] 1s report', 'color: #4af; font-weight: bold');
            console.log(`draws/s:       ${this.drawDurations.length}  (RAF skipped: ${this.rafSkipped}, executed: ${this.rafExecuted})`);
            console.log(`draw ms:       avg=${avgDraw}ms  max=${maxDraw}ms`);
            console.log(`strokes/draw:  avg=${avgStrokes}  max=${maxStrokes}`);
            console.groupEnd();

            // Reset
            this.drawDurations = [];
            this.strokeCounts = [];
            this.drawCallsThisFrame = 0;
            this.rafSkipped = 0;
            this.rafExecuted = 0;
        }
    };
}