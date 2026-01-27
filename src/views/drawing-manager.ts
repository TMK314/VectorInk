import { Point, Stroke, StrokeStyle, Block, PartialBlock } from '../types';
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
        let isTableModeClick = false;

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

        // Mouse events
        const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return; // Nur linke Maustaste

    const point = getPoint(e);
    if (!point) return;

    isMouseDown = true;

    // Prüfe ob wir im Tabellenmodus sind
    const block = this.context.blocks[blockIndex];
    const tableMode = this.context.toolbarManager.getCurrentTableMode();

    if (!block) return;
    
    // Verwende direkt die Canvas-Koordinaten
    const blockX = point.x;
    const blockY = point.y;
    
    if (block.type === 'table' && tableMode &&
        (tableMode === 'vertical-line' || tableMode === 'horizontal-line')) {
        // Tabellen-Linien-Modus: Linie hinzufügen
        isTableModeClick = true;
        // Übergebe den Klick an den TableManager
        const handled = this.context.blockManager.handleCanvasClickForTable(block, blockX, blockY);
        if (handled) {
            e.stopPropagation();
        }
        return;
    }

    // Normales Zeichnen/Radieren
    if (this.currentTool === 'eraser') {
        startErasing(point);
    } else if (this.currentTool === 'pen') {
        startDrawing(point);
        lastPoint = point;
    }
};

        const handleMouseMove = (e: MouseEvent) => {
            const point = getPoint(e);
            if (!point) return;

            // Wenn wir im Tabellenmodus klicken, zeichnen wir nicht
            if (isTableModeClick) return;

            if (this.currentTool === 'eraser' && this.isErasing) {
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

        const handleMouseUp = () => {
            isMouseDown = false;

            if (isTableModeClick) {
                isTableModeClick = false;
                return;
            }

            if (this.currentTool === 'pen') {
                stopDrawing();
            } else if (this.currentTool === 'eraser') {
                stopErasing();
            }

            lastPoint = null;
        };

        const handleMouseLeave = () => {
            if (isMouseDown) {
                handleMouseUp();
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
                }
            }
        };

        const handleTouchEnd = (e: TouchEvent) => {
            e.preventDefault();
            if (this.currentTool === 'pen') {
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

    public drawBlockStrokes(canvas: HTMLCanvasElement, block: Block): void {
        if (!this.context.document) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const isDark = this.context.styleManager.isDarkTheme();
        ctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (const strokeId of block.strokeIds) {
            const stroke = this.context.document.strokes.find(s => s.id === strokeId);
            if (!stroke) continue;

            const displayStyle = this.context.styleManager.getCalculatedStrokeStyle(block.type, stroke.style);

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

        // Prüfe nach rechts (für drawing und table Blöcke)
        if ((block.type === 'drawing' || block.type === 'table') &&
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

            // Für Tabellen: Breite proportional auf alle Spalten verteilen
            if (block.type === 'table' && block.tableGrid) {
                const grid = block.tableGrid;
                const incrementPerCol = amount / grid.cols;
                for (let i = 0; i < grid.cols; i++) {
                    if (grid.colWidths[i] === undefined) continue;
                    grid.colWidths[i]! += incrementPerCol;
                }
            }
        } else {
            block.bbox.height += amount;

            // Für Tabellen: Höhe proportional auf alle Zeilen verteilen
            if (block.type === 'table' && block.tableGrid) {
                const grid = block.tableGrid;
                const incrementPerRow = amount / grid.rows;
                for (let i = 0; i < grid.rows; i++) {
                    if (grid.rowHeights[i] === undefined) continue;
                    grid.rowHeights[i]! += incrementPerRow;
                }
            }
        }

        // Canvas aktualisieren
        this.resizeCanvas(canvas, block);

        // Strokes neu zeichnen
        this.drawBlockStrokes(canvas, block);

        console.log(`Block expanded ${dimension}: ${dimension === 'width' ? `${oldWidth}->${block.bbox.width}` : `${oldHeight}->${block.bbox.height}`}`);
    }

    private adjustTableGridForExpansion(block: Block, dimension: 'width' | 'height', amount: number): void {
        if (!block.tableGrid) return;

        const grid = block.tableGrid;
        const numItems = dimension === 'width' ? grid.cols : grid.rows;
        const incrementPerItem = amount / numItems;

        if (dimension === 'width') {
            for (let i = 0; i < grid.cols; i++) {
                if (grid.colWidths[i] === undefined) continue;
                grid.colWidths[i]! += incrementPerItem;
            }
        } else {
            for (let i = 0; i < grid.rows; i++) {
                if (grid.rowHeights[i] === undefined) continue;
                grid.rowHeights[i]! += incrementPerItem;
            }
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
            block.bbox.width = block.type === 'table' ? 800 : 760;
            block.bbox.height = block.type === 'table' ? 300 : 200;
        } else {
            // Berechne benötigte Größe mit Padding
            const neededWidth = Math.max(maxX + 100, block.type === 'table' ? 800 : 760);
            const neededHeight = Math.max(maxY + 100, block.type === 'table' ? 300 : 200);

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

        // Tabellen-Overlay neu zeichnen
        if (block.type === 'table') {
            setTimeout(() => {
                // Tabellen-Overlay entfernen und neu erstellen
                const blockEl = this.context.blocksContainer?.querySelector(`.ink-block[data-block-id="${block.id}"]`);
                if (blockEl) {
                    const existingOverlay = blockEl.querySelector('.table-grid-overlay');
                    if (existingOverlay) {
                        existingOverlay.remove();
                    }
                    this.context.blockManager.createTableGridOverlay(blockEl as HTMLElement, block);
                }
            }, 50);
        }
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

        // Für Tabellen: Spezielle Logik
        if (block.type === 'table') {
            this.adjustTableBlockSize(block, canvas);
            return;
        }

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

    private adjustTableBlockSize(block: Block, canvas: HTMLCanvasElement): void {
        if (!block.tableGrid) return;

        const grid = block.tableGrid;

        // Mindestgrößen basierend auf Gitter
        const MIN_CELL_WIDTH = 100;
        const MIN_CELL_HEIGHT = 60;
        const PADDING = 40;

        // Berechne benötigte Größe
        const requiredWidth = grid.colWidths.reduce((a, b) => a + b, 0) + PADDING;
        const requiredHeight = grid.rowHeights.reduce((a, b) => a + b, 0) + PADDING;

        // Prüfe, ob Zellen zu klein sind
        let needsResize = false;

        for (let width of grid.colWidths) {
            if (width < MIN_CELL_WIDTH) {
                needsResize = true;
                break;
            }
        }

        for (let height of grid.rowHeights) {
            if (height < MIN_CELL_HEIGHT) {
                needsResize = true;
                break;
            }
        }

        // Prüfe auf Überfüllung (zu viel Leerraum)
        const widthRatio = block.bbox.width / requiredWidth;
        const heightRatio = block.bbox.height / requiredHeight;
        const MAX_WASTE_RATIO = 1.5; // Maximal 50% Leerraum

        if (widthRatio > MAX_WASTE_RATIO || heightRatio > MAX_WASTE_RATIO) {
            needsResize = true;
        }

        if (needsResize) {
            // Neue Größe berechnen
            const newWidth = Math.max(requiredWidth, block.bbox.width * 0.8);
            const newHeight = Math.max(requiredHeight, block.bbox.height * 0.8);

            // Maximal 20% Verkleinerung pro Schritt
            const maxReduction = 0.8; // 20% reduction max
            block.bbox.width = Math.max(newWidth, block.bbox.width * maxReduction);
            block.bbox.height = Math.max(newHeight, block.bbox.height * maxReduction);

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
                        ctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);

                        this.drawBlockStrokes(canvas, block);
                    }
                }
            }
        });
    }
}