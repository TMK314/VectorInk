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
    public epsilon = 0.1;

    private _rafPending = false;
    private _rafCanvas: HTMLCanvasElement | null = null;
    private _rafBlock: Block | null = null;
    private _eraseRafPending = false;
    private _eraseRafCanvas: HTMLCanvasElement | null = null;
    private _eraseRafBlock: Block | null = null;

    public dragOffset: Point = { x: 0, y: 0 };

    private _strokeCache = new Map<string, HTMLCanvasElement>();
    private _spatialIndex: Map<string, string[]> | null = null;
    private readonly _CELL = 80; // logische Pixel pro Zelle
    private _currentDrawStyle: ReturnType<typeof this.context.styleManager.getCalculatedStrokeStyle> | null = null;

    public _currentErasedStrokes: Array<{ stroke: Stroke; blockStrokeIdIndex: number }> = [];

    /**
     * Effektiver DPR für den Stroke-Cache UND das Haupt-Canvas.
     * Cache und Canvas müssen dieselbe Auflösung haben, damit drawImage 1:1 kopiert
     * und keine bilineare Interpolation (Unschärfe) entsteht.
     * Bei viewScale-Änderung muss der Cache invalidiert werden.
     */
    private get _effectiveDpr(): number {
        return (window.devicePixelRatio || 1) * (this.context.viewScale || 1);
    }

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

        // Gecachte BoundingRect & RAF-Flag für flüssiges Selektionsrechteck
        let selectionRafPending = false;

        let lastKnownPressure = 0.5;

        const getPoint = (e: PointerEvent): Point => {
            const rect = canvas.getBoundingClientRect();
            // canvas.style.width = block.bbox.width px (logische Pixel, unverändert)
            // rect.width         = block.bbox.width × cssZoom  (visuelle Pixel)
            // clientX/Y          = visuelle Viewport-Pixel
            // → (clientX - rect.left) × (bbox / rect.width) normiert auf Zeichenkoordinaten
            const block = this.context.blocks[blockIndex];
            const bw = block?.bbox.width  ?? { value: parseFloat(canvas.style.width)  || rect.width };
            const bh = block?.bbox.height ?? { value: parseFloat(canvas.style.height) || rect.height };
            return {
                x: (e.clientX - rect.left) * (bw / rect.width),
                y: (e.clientY - rect.top)  * (bh / rect.height),
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
            if (this.currentTool === 'selection') {
                const strokeId = getStrokeAtPoint(point);
                if (strokeId && this.context.strokeSelectionManager.selectedStrokes.has(strokeId)) return 'move';
                if (isPointOnSelectionBorder(point)) return 'move';
                return 'crosshair';
            }
            return this._getCursorForTool();
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
                const dotStyle = this._currentDrawStyle ?? this.currentPenStyle;
                const dot: Stroke = {
                    id: crypto.randomUUID(),
                    points: [p, { x: p.x + 0.001, y: p.y }], // Winziger Offset → _isDotStroke erkennt ihn
                    bezierCurves: [],
                    style: { ...this.currentPenStyle },
                };
                const added = this.context.document.addStroke(dot);
                block.strokeIds.push(added.id);
                this.updateBlockBoundingBox(block, dot.points);
                this.currentStroke = [];
                lastPoint = null;

                // Direkt als Kreis auf Canvas zeichnen (sofortiges visuelles Feedback)
                const dotCtx = canvas.getContext('2d');
                if (dotCtx) {
                    dotCtx.beginPath();
                    dotCtx.arc(p.x, p.y, Math.max(dotStyle.width / 2, 0.5), 0, Math.PI * 2);
                    dotCtx.fillStyle = dotStyle.color;
                    dotCtx.globalAlpha = dotStyle.opacity ?? 1;
                    dotCtx.fill();
                    dotCtx.globalAlpha = 1;
                }

                this._appendStrokeToCache(block, added);

                // History – damit Undo auch Punkte rückgängig macht
                this.context.historyManager?.push({
                    type: 'ADD_STROKE',
                    blockId: block.id,  // block = der Block, dem der Stroke tatsächlich hinzugefügt wurde
                    stroke: {
                        ...added,
                        points: added.points.map(q => ({ ...q })),
                        bezierCurves: []
                    }
                });
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

            // History – blockId muss GENAU dem Block entsprechen, dem der Stroke hinzugefügt wurde.
            // (block = this.context.blocks[currentBlockIndex], nicht blockIndex aus dem Closure)
            this.context.historyManager?.push({
                type: 'ADD_STROKE',
                blockId: block.id,
                stroke: {
                    ...addedStroke,
                    points: addedStroke.points.map(p => ({ ...p })),
                    bezierCurves: addedStroke.bezierCurves?.map(c => ({ ...c, p0: { ...c.p0 }, p1: { ...c.p1 }, p2: { ...c.p2 }, p3: { ...c.p3 } }))
                }
            });
        };

        const startErasing = (point: Point) => {
            if (blockIndex !== this.context.currentBlockIndex) return;

            this._currentErasedStrokes = [];

            this.isErasing = true;
            lastErasePoint = point;

            const block = this.context.blocks[blockIndex];
            if (block) this._buildSpatialIndex(block);

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
            // History für diese Radier-Session
            if (this._currentErasedStrokes.length > 0) {
                const block = this.context.blocks[blockIndex];
                if (block) {
                    this.context.historyManager?.push({
                        type: 'ERASE_STROKES',
                        blockId: block.id,
                        strokes: this._currentErasedStrokes.map(e => ({
                            ...e.stroke,
                            points: e.stroke.points.map(p => ({ ...p })),
                            bezierCurves: e.stroke.bezierCurves?.map(c => ({
                                ...c,
                                p0: { ...c.p0 },
                                p1: { ...c.p1 },
                                p2: { ...c.p2 },
                                p3: { ...c.p3 }
                            })),
                            style: { ...e.stroke.style }
                        })),
                        blockStrokeIdIndices: this._currentErasedStrokes.map(e => e.blockStrokeIdIndex)
                    });
                }
                this._currentErasedStrokes = [];
            }

            this.isErasing = false;
            lastErasePoint = null;
            this._spatialIndex = null;

            const block = this.context.blocks[blockIndex];
            if (!block) return;

            const blockCanvas = this.context.blockManager.getCanvasForBlock(block.id);
            if (blockCanvas) {
                // Einmaliger vollständiger Rebuild nach dem Löschen
                this.invalidateBlockCache(block.id);
                this._drawBlockStrokesImmediate(blockCanvas, block);
            }
            // Größe nur einmal am Ende anpassen — niemals während des Löschens
            this.adjustBlockSizeAfterErasing(block.id);
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

                // Selektionsrechteck: position:fixed — bleibt im Viewport verankert
                // unabhängig vom Scroll-Offset. Koordinaten werden pro Frame aus
                // canvas.getBoundingClientRect() neu berechnet.
                selectionBox = document.createElement('div');
                selectionBox.className = 'stroke-selection-box';
                selectionBox.style.position = 'fixed';
                this.applySelectionBoxTheme(selectionBox);
                selectionBox.style.pointerEvents = 'none';
                selectionBox.style.zIndex = '1000';
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

            if (!selectionRafPending) {
                selectionRafPending = true;
                const snapX = x, snapY = y, snapW = width, snapH = height;
                requestAnimationFrame(() => {
                    selectionRafPending = false;
                    if (!selectionBox) return;

                    // Rect frisch lesen (kompensiert Scroll + Zoom korrekt,
                    // da getBoundingClientRect stets aktuelle Viewport-Position liefert)
                    const rect = canvas.getBoundingClientRect();
                    const block = this.context.blocks[blockIndex];
                    const bw = block?.bbox.width  || parseFloat(canvas.style.width)  || rect.width;
                    const bh = block?.bbox.height || parseFloat(canvas.style.height) || rect.height;
                    // Skala: Canvas-Koordinaten → CSS-Viewport-Pixel
                    const scaleX = rect.width  / bw;
                    const scaleY = rect.height / bh;

                    selectionBox.style.left   = `${rect.left + snapX * scaleX}px`;
                    selectionBox.style.top    = `${rect.top  + snapY * scaleY}px`;
                    selectionBox.style.width  = `${snapW * scaleX}px`;
                    selectionBox.style.height = `${snapH * scaleY}px`;
                });
            }
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

            // History für Move
            const movedIds = [...this.context.strokeSelectionManager.selectedStrokes];
            if (movedIds.length > 0 && originalStrokeData.size > 0) {
                const firstId = movedIds[0];
                const origData = firstId ? originalStrokeData.get(firstId) : undefined;
                const currentStroke = firstId ? this.context.document?.getStroke(firstId) : undefined;
                if (origData && currentStroke && origData.points[0] && currentStroke.points[0]) {
                    const dx = currentStroke.points[0].x - origData.points[0].x;
                    const dy = currentStroke.points[0].y - origData.points[0].y;
                    if (dx !== 0 || dy !== 0) {
                        const block = this.context.blocks[blockIndex];
                        if (block) {
                            this.context.historyManager?.push({
                                type: 'MOVE_STROKES',
                                blockId: block.id,
                                strokeIds: movedIds,
                                dx,
                                dy
                            });
                        }
                    }
                }
            }

            // Cache invalidieren, damit Strokes bei nächstem Render an neuer Position gezeichnet werden
            const moveBlock = this.context.blocks[blockIndex];
            if (moveBlock) {
                this.invalidateBlockCache(moveBlock.id);
            }

            isDraggingSelection = false;
            dragStartPoint = null;
            originalStrokeData.clear();

            const block = this.context.blocks[blockIndex];
            if (block) {
                this.adjustBlockSize(block.id);
            }

            this.context.saveDocument();
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
            canvas.setPointerCapture(e.pointerId);
            const point = getPoint(e);
            isMouseDown = true;
            // updateCursor absichtlich NICHT hier — getStrokeAtPoint ist O(n·m)
            // und würde den Start jedes Strokes um 20–50ms verzögern.
            // Cursor-Updates laufen bereits in handlePointerMove (nur im Ruhezustand).
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
            canvas.style.cursor = this._getCursorForTool();
            if (isMouseDown) handlePointerUp(new PointerEvent('pointerup'));
            if (isSelectingRect && selectionBox) {
                selectionBox.remove(); selectionBox = null;
                isSelectingRect = false; selectionRectStart = null;
            }
        };

        const handlePointerEnter = () => {
            canvas.style.cursor = this._getCursorForTool();
        };

        // Pointer Events (vereinheitlicht Mouse + Touch + Stylus)
        canvas.style.touchAction = 'none';
        canvas.style.cursor = this._getCursorForTool(); // sofort beim Aufbau
        canvas.addEventListener('pointerdown', handlePointerDown);
        canvas.addEventListener('pointermove', handlePointerMove);
        canvas.addEventListener('pointerup', handlePointerUp);
        canvas.addEventListener('pointerleave', handlePointerLeave);
        canvas.addEventListener('pointerenter', handlePointerEnter);

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
                    // Nicht rendern wenn aktiv gezeichnet wird — draw() schreibt direkt auf den Canvas.
                    // Der nächste Render nach stopDrawing zeigt den korrekten Zustand.
                    if (this._rafCanvas && this._rafBlock && !this.isDrawing) {
                        this._drawBlockStrokesImmediate(this._rafCanvas, this._rafBlock);
                    }
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
            : (getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || (isDark ? '#1a1a1a' : '#ffffff'));

        let cache = this._strokeCache.get(block.id);
        // Cache-Größe muss mit effectiveDpr übereinstimmen — bei viewScale-Änderung
        // wird der Cache von resizeAllCanvasesForViewScale() invalidiert.
        const effectiveDpr = this._effectiveDpr;
        const needsRebuild = !cache
            || cache.width !== block.bbox.width * effectiveDpr
            || cache.height !== block.bbox.height * effectiveDpr;

        if (needsRebuild) {
            cache = document.createElement('canvas');
            cache.width = block.bbox.width * effectiveDpr;
            cache.height = block.bbox.height * effectiveDpr;
            this._strokeCache.set(block.id, cache);
            this._renderStrokesToCache(cache, block, ds, bgColor, isDark);
        }

        // setTransform mit effectiveDpr: logische Koordinaten → physische Canvas-Pixel.
        // Cache (effectiveDpr-Pixel) → drawImage mit logischer Zielgröße → 1:1-Kopie, keine Interpolation.
        ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
        ctx.clearRect(0, 0, block.bbox.width, block.bbox.height);
        if (cache) ctx.drawImage(cache, 0, 0, block.bbox.width, block.bbox.height);

        if (this.isDrawing && this.currentStroke.length >= 1) {
            const currentBlock = this.context.blocks[this.context.currentBlockIndex];
            if (currentBlock?.id === block.id) {
                const displayStyle = this.context.styleManager.getCalculatedStrokeStyle(
                    block.type, this.currentPenStyle
                );
                if (this.currentStroke.length === 1) {
                    // Ersten Punkt sofort als Kreis anzeigen
                    const p = this.currentStroke[0]!;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, Math.max(displayStyle.width / 2, 0.5), 0, Math.PI * 2);
                    ctx.fillStyle = displayStyle.color;
                    ctx.globalAlpha = displayStyle.opacity ?? 1;
                    ctx.fill();
                    ctx.globalAlpha = 1;
                } else {
                    this.drawLinearStroke(ctx, this.currentStroke, displayStyle);
                }
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
        if (!this.context.document) return;
        const ctx = cache.getContext('2d');
        if (!ctx) return;

        const dpr = this._effectiveDpr;

        // Hintergrund in physischen Pixeln füllen (vor dem Scale)
        ctx.clearRect(0, 0, cache.width, cache.height);
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, cache.width, cache.height);

        // effectiveDpr-Transform: Striche in logischen Koordinaten → volle Pixelauflösung
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.drawGrid(cache, block);

        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.getStroke(strokeId); // O(1) via Map
            if (!stroke) continue;
            const displayStyle = this.context.styleManager.getCalculatedStrokeStyle(
                block.type, stroke.style, ds.useColor, ds.widthMultiplier
            );
            this._drawStrokeOnContext(ctx, stroke, displayStyle);
        }
    }

    /** Einheitliche Render-Methode für einen Stroke auf einem beliebigen 2D-Context */
    private _drawStrokeOnContext(
        ctx: CanvasRenderingContext2D,
        stroke: Stroke,
        displayStyle: ReturnType<typeof this.context.styleManager.getCalculatedStrokeStyle>
    ): void {
        if (stroke.bezierCurves && stroke.bezierCurves.length > 0) {
            this.drawBezierStroke(ctx, stroke.bezierCurves, displayStyle);
        } else if (this._isDotStroke(stroke)) {
            this._drawDotOnContext(ctx, stroke.points[0]!, displayStyle);
        } else if (stroke.points.length >= 2) {
            this.drawLinearStroke(ctx, stroke.points, displayStyle);
        }
    }

    /** Erkennt einen Ein-Punkt-Stroke (Offset < 0.5 px) */
    private _isDotStroke(stroke: Stroke): boolean {
        if (stroke.points.length !== 2) return false;
        const dx = stroke.points[1]!.x - stroke.points[0]!.x;
        const dy = stroke.points[1]!.y - stroke.points[0]!.y;
        return Math.hypot(dx, dy) < 0.5;
    }

    /** Zeichnet einen gefüllten Kreis für Ein-Punkt-Strokes */
    private _drawDotOnContext(
        ctx: CanvasRenderingContext2D,
        p: Point,
        displayStyle: ReturnType<typeof this.context.styleManager.getCalculatedStrokeStyle>
    ): void {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(displayStyle.width / 2, 0.5), 0, Math.PI * 2);
        ctx.fillStyle = displayStyle.color;
        ctx.globalAlpha = displayStyle.opacity ?? 1;
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    public invalidateBlockCache(blockId: string): void {
        this._strokeCache.delete(blockId);
    }

    private _appendStrokeToCache(block: Block, stroke: Stroke): void {
        const cache = this._strokeCache.get(block.id);
        if (!cache) return; // kein Cache vorhanden → wird beim nächsten Draw neu gebaut

        const ctx = cache.getContext('2d');
        if (!ctx) return;

        // effectiveDpr-Transform explizit setzen (konsistent mit _renderStrokesToCache)
        ctx.setTransform(this._effectiveDpr, 0, 0, this._effectiveDpr, 0, 0);

        const ds = this.getBlockDisplaySettings(block);
        const displayStyle = this.context.styleManager.getCalculatedStrokeStyle(
            block.type, stroke.style, ds.useColor, ds.widthMultiplier
        );

        this._drawStrokeOnContext(ctx, stroke, displayStyle);
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
        const padding = 60; // Weniger Padding für präzisere Kontrolle
        const threshold = 30; // Niedrigerer Schwellenwert

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

        const effectiveDpr = this._effectiveDpr;

        // Cache in effectiveDpr-Größe erweitern, Inhalt kopieren
        const oldCache = this._strokeCache.get(block.id);
        const newCache = document.createElement('canvas');
        newCache.width = block.bbox.width * effectiveDpr;
        newCache.height = block.bbox.height * effectiveDpr;
        const cCtx = newCache.getContext('2d');
        if (cCtx) {
            const ds = this.getBlockDisplaySettings(block);
            const isDark = this.context.styleManager.isDarkTheme();
            const bgColor = ds.useColor
                ? (ds.backgroundColor ?? '#ffffff')
                : (getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || (isDark ? '#1a1a1a' : '#ffffff'));
            // 1. Hintergrund in physischen Pixeln (vor Transform)
            cCtx.fillStyle = bgColor;
            cCtx.fillRect(0, 0, newCache.width, newCache.height);
            // 2. Alten Cache 1:1 kopieren (beide effectiveDpr-skaliert)
            if (oldCache) cCtx.drawImage(oldCache, 0, 0);
            // 3. effectiveDpr-Transform für spätere inkrementelle Striche setzen
            cCtx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
        }
        this._strokeCache.set(block.id, newCache);

        // Canvas (physisch) vergrößern — canvas.width-Zuweisung löscht Kontext-State
        canvas.width = block.bbox.width * effectiveDpr;
        canvas.height = block.bbox.height * effectiveDpr;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            // Cache in logischen Koordinaten zeichnen → 1:1-Kopie, keine Interpolation
            ctx.drawImage(newCache, 0, 0, block.bbox.width, block.bbox.height);
            // Aktuell gezeichneten Stroke wiederherstellen (liegt nicht im Cache)
            if (this.isDrawing && this.currentStroke.length >= 2) {
                const style = this._currentDrawStyle ?? this.currentPenStyle;
                this.drawLinearStroke(ctx, this.currentStroke, style);
            }
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
        const effectiveDpr = this._effectiveDpr;

        canvas.width = block.bbox.width * effectiveDpr;
        canvas.height = block.bbox.height * effectiveDpr;

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
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

        let maxX = 0;
        let maxY = 0;
        let hasStrokes = false;

        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.getStroke(strokeId); // O(1) via Map
            if (!stroke || stroke.points.length === 0) continue;
            hasStrokes = true;
            for (const point of stroke.points) {
                if (point.x > maxX) maxX = point.x;
                if (point.y > maxY) maxY = point.y;
            }
        }

        if (!hasStrokes) {
            block.bbox.width = 760;
            block.bbox.height = 200;
        } else {
            const neededWidth = Math.max(maxX + 100, 760);
            const neededHeight = Math.max(maxY + 100, 200);
            // Konservativ schrumpfen: nur wenn > 250px Überschuss
            if (block.bbox.width - neededWidth > 250) block.bbox.width = neededWidth;
            if (block.bbox.height - neededHeight > 250) block.bbox.height = neededHeight;
        }

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

    private _buildSpatialIndex(block: Block): void {
        this._spatialIndex = new Map();
        if (!this.context.document) return;
        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.getStroke(strokeId);
            if (stroke) this._indexStroke(strokeId, stroke.points);
        }
    }

    private _indexStroke(strokeId: string, points: Point[]): void {
        if (!this._spatialIndex) return;
        const seen = new Set<string>();
        for (const p of points) {
            const key = `${Math.floor(p.x / this._CELL)},${Math.floor(p.y / this._CELL)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            let arr = this._spatialIndex.get(key);
            if (!arr) { arr = []; this._spatialIndex.set(key, arr); }
            arr.push(strokeId);
        }
    }

    private _unindexStroke(strokeId: string, points: Point[]): void {
        if (!this._spatialIndex) return;
        const seen = new Set<string>();
        for (const p of points) {
            const key = `${Math.floor(p.x / this._CELL)},${Math.floor(p.y / this._CELL)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const arr = this._spatialIndex.get(key);
            if (arr) {
                const i = arr.indexOf(strokeId);
                if (i >= 0) arr.splice(i, 1);
            }
        }
    }

    private _candidateStrokes(point: Point, radius: number): Set<string> {
        const result = new Set<string>();
        if (!this._spatialIndex) return result;
        const x0 = Math.floor((point.x - radius) / this._CELL);
        const x1 = Math.floor((point.x + radius) / this._CELL);
        const y0 = Math.floor((point.y - radius) / this._CELL);
        const y1 = Math.floor((point.y + radius) / this._CELL);
        for (let cx = x0; cx <= x1; cx++) {
            for (let cy = y0; cy <= y1; cy++) {
                const arr = this._spatialIndex.get(`${cx},${cy}`);
                if (arr) for (const id of arr) result.add(id);
            }
        }
        return result;
    }

    private _patchCacheRect(
        cache: HTMLCanvasElement,
        block: Block,
        ds: BlockDisplaySettings,
        bgColor: string,
        isDark: boolean,
        x: number, y: number, w: number, h: number,
        margin: number
    ): void {
        const ctx = cache.getContext('2d');
        if (!ctx || !this.context.document) return;

        const rx = Math.max(0, x - margin);
        const ry = Math.max(0, y - margin);
        const rw = Math.min(cache.width - rx, w + margin * 2);
        const rh = Math.min(cache.height - ry, h + margin * 2);
        if (rw <= 0 || rh <= 0) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.clip();

        ctx.fillStyle = bgColor;
        ctx.fillRect(rx, ry, rw, rh);

        // Grid im Dirty-Rect neu zeichnen (durch Clip begrenzt)
        this.drawGrid(cache, block);

        // Nur Strokes die den Dirty-Rect schneiden neu zeichnen
        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.getStroke(strokeId);
            if (!stroke) continue;

            // Schnittprüfung anhand der Punkte
            let intersects = false;
            for (const p of stroke.points) {
                if (p.x >= rx && p.x <= rx + rw && p.y >= ry && p.y <= ry + rh) {
                    intersects = true; break;
                }
            }
            if (!intersects) continue;

            const displayStyle = this.context.styleManager.getCalculatedStrokeStyle(
                block.type, stroke.style, ds.useColor, ds.widthMultiplier
            );
            this._drawStrokeOnContext(ctx, stroke, displayStyle);
        }

        ctx.restore();
    }

    private eraseAtPoint(canvas: HTMLCanvasElement, blockIndex: number, point: Point): void {
        const block = this.context.blocks[blockIndex];
        if (!block || !this.context.document) return;

        const eraserRadius = this.currentPenStyle.width * 5;

        const candidates = this._spatialIndex
            ? this._candidateStrokes(point, eraserRadius)
            : new Set(block.strokeIds);

        const strokeIdsToRemove: string[] = [];

        if (this.eraserMode === 'stroke') {
            for (const strokeId of candidates) {
                if (!block.strokeIds.includes(strokeId)) continue;
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
                        const p1 = stroke.points[i]!;
                        const p2 = stroke.points[i + 1]!;
                        if (this.distanceToLineSegment(point, p1, p2) <= eraserRadius) {
                            hit = true; break;
                        }
                    }
                }
                if (hit) strokeIdsToRemove.push(strokeId);
            }
        } else {
            for (const strokeId of candidates) {
                if (!block.strokeIds.includes(strokeId)) continue;
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

        for (const strokeId of strokeIdsToRemove) {
            const stroke = this.context.document.getStroke(strokeId);
            if (stroke) this._unindexStroke(strokeId, stroke.points);
        }

        // Für History: Strokes mit Originalindex sichern
        strokeIdsToRemove.forEach(id => {
            const idx = block.strokeIds.indexOf(id);
            const stroke = this.context.document?.getStroke(id);
            if (stroke && idx >= 0) {
                this._currentErasedStrokes.push({
                    stroke: { ...stroke, points: stroke.points.map(p => ({ ...p })), bezierCurves: stroke.bezierCurves?.map(c => ({ ...c })) },
                    blockStrokeIdIndex: idx
                });
            }
        });

        block.strokeIds = block.strokeIds.filter(id => !strokeIdsToRemove.includes(id));
        strokeIdsToRemove.forEach(id => this.context.document!.removeStroke(id));

        // Cache invaliden — Rebuild beim nächsten RAF-Frame
        this.invalidateBlockCache(block.id);

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
        const MIN_HEIGHT = isSelected ? 200 : 150;

        if (block.strokeIds.length === 0) {
            return { width: block.bbox.width, height: MIN_HEIGHT };
        }

        let maxY = -Infinity;
        let hasStrokes = false;

        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.getStroke(strokeId);
            if (!stroke || stroke.points.length === 0) continue;
            hasStrokes = true;
            for (const point of stroke.points) {
                if (point.y > maxY) maxY = point.y;
            }
        }

        if (!hasStrokes || maxY === -Infinity) {
            return { width: block.bbox.width, height: MIN_HEIGHT };
        }

        const verticalPadding = 60;
        const calculatedHeight = Math.max(MIN_HEIGHT, maxY + verticalPadding);

        // Breite nur für Drawing-Blöcke berechnen und anpassen
        if (block.type === 'drawing') {
            let maxX = -Infinity;
            for (const strokeId of block.strokeIds) {
                const stroke = this.context.document.getStroke(strokeId);
                if (!stroke) continue;
                for (const point of stroke.points) {
                    if (point.x > maxX) maxX = point.x;
                }
            }
            const MIN_WIDTH = 760;
            const calculatedWidth = Math.max(MIN_WIDTH, maxX + 80);
            const shrinkThreshold = 250;
            return {
                width: block.bbox.width - calculatedWidth > shrinkThreshold ? calculatedWidth : block.bbox.width,
                height: block.bbox.height - calculatedHeight > shrinkThreshold ? calculatedHeight : block.bbox.height,
            };
        }

        // Alle anderen Typen: nur Höhe anpassen, Breite unveränderlich
        return {
            width: block.bbox.width,
            height: block.bbox.height - calculatedHeight > 250 ? calculatedHeight : block.bbox.height,
        };
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
        if (this.currentTool === tool) return;
        this.currentTool = tool;

        if (tool !== 'pen')       { this.isDrawing = false; this.currentStroke = []; }
        if (tool !== 'eraser')    { this.isErasing = false; }
        if (tool !== 'selection') {
            this.context.strokeSelectionManager.selectedStrokes.clear();
            this.dragOffset = { x: 0, y: 0 };
            this.context.drawingManager.redrawAllBlocks();
        }

        this._updateAllCanvasCursors();
        this.context.toolbarManager?.syncToolbarToTool(tool);
    }

    // ── Cursor-Hilfsmethoden ─────────────────────────────────────────────

    /** CSS-Cursor für das aktuelle Werkzeug. public → nutzbar in InkEmbedRenderer. */
    public _getCursorForTool(): string {
        if (this.currentTool === 'eraser') return this._buildEraserCursor();
        return 'crosshair'; // pen & selection
    }

    private _buildEraserCursor(): string {
        const r = 12, size = r * 2 + 6, cx = r + 3, cy = r + 3;
        const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
            `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,255,255,0.1)" stroke="#666" stroke-width="1.5"/>` +
            `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.8"/>` +
            `</svg>`;
        return `url('data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}') ${cx} ${cy}, cell`;
    }

    private _updateAllCanvasCursors(): void {
        if (!this.context.blocksContainer) return;
        const cursor = this._getCursorForTool();
        this.context.blocksContainer
            .querySelectorAll<HTMLCanvasElement>('canvas')
            .forEach(c => { c.style.cursor = cursor; });
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

    /**
     * Wird von InkView.setViewScale() aufgerufen.
     * Passt das physische Canvas-Backing aller Blöcke an den neuen effectiveDpr an,
     * ohne den Stroke-Cache zu invalidieren (der ist DPR-basiert und bleibt gültig).
     */
    public resizeAllCanvasesForViewScale(): void {
        if (!this.context.blocksContainer) return;
        const effectiveDpr = this._effectiveDpr;

        this.context.blocksContainer.querySelectorAll<HTMLCanvasElement>('canvas').forEach(canvas => {
            const blockId = canvas.closest('.ink-block')?.getAttribute('data-block-id');
            if (!blockId) return;
            const block = this.context.blocks.find(b => b.id === blockId);
            if (!block) return;

            // Canvas auf neue Größe bringen
            canvas.width  = block.bbox.width  * effectiveDpr;
            canvas.height = block.bbox.height * effectiveDpr;

            // Cache invalidieren: er hat noch alte effectiveDpr-Auflösung →
            // _drawBlockStrokesImmediate baut ihn mit neuer Auflösung neu auf
            this.invalidateBlockCache(blockId);
            this._drawBlockStrokesImmediate(canvas, block);
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

        // Logische Dimensionen verwenden (ctx hat bereits DPR-Transform gesetzt)
        const width = block.bbox.width;
        const height = block.bbox.height;

        switch (grid.type) {
            case 'grid':
                this.drawGridPattern(ctx, width, height, grid.size);
                break;
            case 'lines':
                this.drawLinePattern(ctx, width, height, grid.size);
                break;
            case 'dots':
                this.drawDotPattern(ctx, width, height, grid.size);
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

    /**
 * Rendert einen Block sofort synchron auf den Canvas – ohne RAF/Idle-Deferral.
 * Nur für History-Operationen (Undo/Redo) verwenden.
 */
    public renderBlockSync(canvas: HTMLCanvasElement, block: Block): void {
        if (!this.context.document) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const ds = this.getBlockDisplaySettings(block);
        const isDark = this.context.styleManager.isDarkTheme();
        const bgColor = !ds.useColor
            ? (getComputedStyle(document.body).getPropertyValue('--background-primary').trim()
                || (isDark ? '#1a1a1a' : '#ffffff'))
            : (ds.backgroundColor ?? '#ffffff');

        // Cache in effectiveDpr-Auflösung — identisch mit _drawBlockStrokesImmediate
        const effectiveDpr = this._effectiveDpr;
        const cache = document.createElement('canvas');
        cache.width = block.bbox.width * effectiveDpr;
        cache.height = block.bbox.height * effectiveDpr;
        this._strokeCache.set(block.id, cache);

        this._renderStrokesToCache(cache, block, ds, bgColor, isDark);

        ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
        ctx.clearRect(0, 0, block.bbox.width, block.bbox.height);
        ctx.drawImage(cache, 0, 0, block.bbox.width, block.bbox.height);

        this.context.strokeSelectionManager.drawSelectionHighlights(canvas, block);
    }

    private applySelectionBoxTheme(selectionBox: HTMLElement): void {
        selectionBox.style.border = '2px dashed var(--interactive-accent)';
        selectionBox.style.background =
            'color-mix(in srgb, var(--interactive-accent) 20%, transparent)';
    }

}