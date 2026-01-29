import { Block, TableCell, TableGrid } from '../types';
import { InkView } from './InkView';
import { Notice } from 'obsidian';

export class TableManager {
    private context: InkView;
    private selectedLine: { type: 'horizontal' | 'vertical', index: number } | null = null;
    private isDraggingLine = false;
    private dragStartPosition = { x: 0, y: 0 };
    private dragStartLinePosition = 0;
    private mergeStartCell: { row: number, col: number } | null = null;
    private isMovingLine = false;
    private isMergingCells = false;
    private tableToolMode: 'add-line' | 'move-line' | 'merge-cells' | null = null;
    private lineDragStartPosition = 0;
    private lineDragStartIndex = 0;
    private animationFrameId: number | null = null;
    private lastClickTime = 0;

    constructor(context: InkView) {
        this.context = context;
    }

    public createTableGridOverlay(blockEl: HTMLElement, block: Block): void {
        if (!block.tableGrid) {
            this.initializeEmptyTableGrid(block);
        }

        // Entferne vorhandene Overlays
        const existingOverlay = blockEl.querySelector('.table-grid-overlay');
        if (existingOverlay) {
            existingOverlay.remove();
        }

        // Warte bis das Block-Element vollständig im DOM ist
        if (!document.body.contains(blockEl)) {
            setTimeout(() => {
                this.createTableGridOverlay(blockEl, block);
            }, 50);
            return;
        }

        // Finde das Canvas-Element
        const canvas = blockEl.querySelector('canvas');
        if (!canvas) {
            console.error('Canvas not found in block');
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'table-grid-overlay';
        overlay.style.position = 'absolute';

        // Positioniere das Overlay relativ zum Canvas
        const canvasRect = canvas.getBoundingClientRect();
        const blockRect = blockEl.getBoundingClientRect();

        // Berechne die Position des Canvas innerhalb des Blocks
        const canvasLeft = canvasRect.left - blockRect.left;
        const canvasTop = canvasRect.top - blockRect.top;

        overlay.style.left = `${canvasLeft}px`;
        overlay.style.top = `${canvasTop}px`;
        overlay.style.width = `${canvasRect.width}px`;
        overlay.style.height = `${canvasRect.height}px`;
        overlay.style.pointerEvents = 'none'; // WICHTIG: Lässt Klicks durch zum Canvas
        overlay.style.zIndex = '5';

        const grid = block.tableGrid!;

        // Zeichne horizontale Linien
        this.drawGridLines(overlay, grid, block, canvasRect.width, canvasRect.height);

        // Canvas-Grenzen als Linien hinzufügen
        this.drawCanvasBoundaryLines(overlay, grid, block, canvasRect.width, canvasRect.height);

        // Nur Zellen-Hover im Merge-Modus
        const tableMode = this.context.toolbarManager.getCurrentTableMode();
        if (tableMode === 'merge-cells') {
            this.createCellOverlays(overlay, grid, block, canvasRect.width, canvasRect.height);
        }

        // Sicherstellen, dass das Block-Element noch existiert
        if (document.body.contains(blockEl)) {
            blockEl.appendChild(overlay);
        }
    }

    private initializeEmptyTableGrid(block: Block): void {
        if (block.type !== 'table') return;

        // Erstelle eine leere Tabelle mit nur den Canvas-Grenzen
        block.tableGrid = {
            id: crypto.randomUUID(),
            rows: 0,
            cols: 0,
            rowHeights: [],
            colWidths: [],
            cells: []
        };
    }

    private drawCanvasBoundaryLines(
        overlay: HTMLElement,
        grid: TableGrid,
        block: Block,
        canvasWidth: number,
        canvasHeight: number
    ): void {
        // Zeichne nur sehr dezente Grenzlinien ohne Interaktion
        const boundaryStyle = '1px dashed rgba(128, 128, 128, 0.2)';

        // Linke Grenze (sehr dezent)
        const leftLine = document.createElement('div');
        leftLine.style.position = 'absolute';
        leftLine.style.left = '0';
        leftLine.style.top = '0';
        leftLine.style.width = '1px';
        leftLine.style.height = '100%';
        leftLine.style.borderLeft = boundaryStyle;
        leftLine.style.pointerEvents = 'none'; // Keine Interaktion
        overlay.appendChild(leftLine);

        // Rechte Grenze
        const rightLine = document.createElement('div');
        rightLine.style.position = 'absolute';
        rightLine.style.right = '0';
        rightLine.style.top = '0';
        rightLine.style.width = '1px';
        rightLine.style.height = '100%';
        rightLine.style.borderRight = boundaryStyle;
        rightLine.style.pointerEvents = 'none';
        overlay.appendChild(rightLine);

        // Obere Grenze
        const topLine = document.createElement('div');
        topLine.style.position = 'absolute';
        topLine.style.left = '0';
        topLine.style.top = '0';
        topLine.style.width = '100%';
        topLine.style.height = '1px';
        topLine.style.borderTop = boundaryStyle;
        topLine.style.pointerEvents = 'none';
        overlay.appendChild(topLine);

        // Untere Grenze
        const bottomLine = document.createElement('div');
        bottomLine.style.position = 'absolute';
        bottomLine.style.left = '0';
        bottomLine.style.bottom = '0';
        bottomLine.style.width = '100%';
        bottomLine.style.height = '1px';
        bottomLine.style.borderBottom = boundaryStyle;
        bottomLine.style.pointerEvents = 'none';
        overlay.appendChild(bottomLine);
    }

    public insertTableColumnAtPosition(blockId: string, colIndex: number, position: number): void {
        const block = this.context.blocks.find(b => b.id === blockId);
        if (!block || !block.tableGrid) {
            console.error('Block nicht gefunden oder kein tableGrid:', blockId);
            return;
        }

        const grid = block.tableGrid;
        const DEFAULT_WIDTH = 150;

        // Bestimme die Breite basierend auf der Position
        let newWidth = DEFAULT_WIDTH;
        if (colIndex === 0) {
            // Linke Grenze: Position ist der Abstand von links
            newWidth = Math.max(DEFAULT_WIDTH, position);
        } else if (colIndex === grid.cols) {
            // Rechte Grenze: Position ist die Breite von links
            newWidth = Math.max(DEFAULT_WIDTH, block.bbox.width - position);
        }

        // Spalte einfügen
        grid.colWidths.splice(colIndex, 0, newWidth);
        grid.cols += 1;

        // Zellen anpassen
        for (let i = 0; i < grid.cells.length; i++) {
            const cell = grid.cells[i];
            if (cell === undefined) continue;
            if (cell.col >= colIndex) {
                cell.col += 1;
            }
        }

        // Neue Zellen für die neue Spalte hinzufügen
        for (let row = 0; row < grid.rows; row++) {
            grid.cells.push({
                id: crypto.randomUUID(),
                row,
                col: colIndex,
                rowSpan: 1,
                colSpan: 1
            });
        }

        // Block-Größe anpassen
        const totalWidth = grid.colWidths.reduce((a, b) => a + b, 0) + 40;
        block.bbox.width = Math.max(block.bbox.width, totalWidth);

        this.context.blockManager.renderBlocks();
    }

    private drawGridLines(
        overlay: HTMLElement,
        grid: TableGrid,
        block: Block,
        canvasWidth: number,
        canvasHeight: number
    ): void {
        // Berechne das Verhältnis zwischen Canvas-Größe und Block-Größe
        const widthRatio = canvasWidth / block.bbox.width;
        const heightRatio = canvasHeight / block.bbox.height;

        // Zeichne ALLE horizontale Linien (0 bis grid.rows)
        let currentY = 0;
        for (let i = 0; i <= grid.rows; i++) {
            // Für die letzte Linie, verwende die Gesamthöhe
            let lineY;
            if (i < grid.rows) {
                lineY = currentY * heightRatio;
                if (i < grid.rows && grid.rowHeights[i] !== undefined) {
                    currentY += grid.rowHeights[i]!;
                }
            } else {
                // Letzte Linie am unteren Rand
                lineY = canvasHeight - 2;
            }

            // Zeichne horizontale Linie
            const lineEl = this.createGridLine('horizontal', i, lineY, grid, block, canvasWidth);
            overlay.appendChild(lineEl);
        }

        // Zeichne ALLE vertikale Linien (0 bis grid.cols)
        let currentX = 0;
        for (let i = 0; i <= grid.cols; i++) {
            // Für die letzte Linie, verwende die Gesamtbreite
            let lineX;
            if (i < grid.cols) {
                lineX = currentX * widthRatio;
                if (i < grid.cols && grid.colWidths[i] !== undefined) {
                    currentX += grid.colWidths[i]!;
                }
            } else {
                // Letzte Linie am rechten Rand
                lineX = canvasWidth - 2;
            }

            // Zeichne vertikale Linie
            const lineEl = this.createGridLine('vertical', i, lineX, grid, block, canvasWidth);
            overlay.appendChild(lineEl);
        }
    }

    private createGridLine(
        type: 'horizontal' | 'vertical',
        index: number,
        position: number,
        grid: TableGrid,
        block: Block,
        canvasWidth?: number
    ): HTMLElement {
        const lineEl = document.createElement('div');
        lineEl.className = `grid-line ${type}-line`;
        lineEl.dataset.lineType = type;
        lineEl.dataset.lineIndex = index.toString();
        lineEl.dataset.blockId = block.id;

        const isSelected = this.selectedLine?.type === type && this.selectedLine?.index === index;

        if (type === 'horizontal') {
            lineEl.style.position = 'absolute';
            lineEl.style.top = `${position}px`;
            lineEl.style.left = '0';
            lineEl.style.width = '100%';
            lineEl.style.height = '2px';
            lineEl.style.backgroundColor = isSelected ? 'var(--text-accent)' : 'var(--interactive-accent)';
            lineEl.style.opacity = isSelected ? '0.9' : '0.6';
            lineEl.style.cursor = 'ns-resize';
            lineEl.style.zIndex = '10';
            lineEl.style.pointerEvents = 'auto';
        } else {
            lineEl.style.position = 'absolute';
            lineEl.style.left = `${position}px`;
            lineEl.style.top = '0';
            lineEl.style.width = '2px';
            lineEl.style.height = '100%';
            lineEl.style.backgroundColor = isSelected ? 'var(--text-accent)' : 'var(--interactive-accent)';
            lineEl.style.opacity = isSelected ? '0.9' : '0.6';
            lineEl.style.cursor = 'ew-resize';
            lineEl.style.zIndex = '10';
            lineEl.style.pointerEvents = 'auto';
        }

        // Event-Listener für ALLE Linien gleich behandeln
        this.setupGridLineEvents(lineEl, type, index, block);

        return lineEl;
    }

    private adjustLineForMergedCells(lineEl: HTMLElement, type: 'horizontal' | 'vertical', index: number, grid: TableGrid): void {
        // Für horizontale Linien: index ist die Zeilennummer (0-basiert)
        // Die Linie zwischen Zeile index-1 und index
        if (type === 'horizontal') {
            // Finde alle Zellen, die diese Linie kreuzen
            if (index === 0 || index === grid.rows) {
                return; // Keine Anpassung für äußerste horizontale Linien
            }
            const relevantCells = grid.cells.filter(cell => {
                // Linie liegt zwischen Zeilen, also prüfe ob Zelle über diese Linie geht
                if (index > 0) {
                    // Innere horizontale Linie
                    return cell.row < index && cell.row + cell.rowSpan > index;
                }
                return false;
            });

            if (relevantCells.length > 0) {
                // Wenn Linie durch gemergte Zellen geht, zeichne sie gestrichelt
                lineEl.style.borderTop = '2px dashed var(--interactive-accent)';
                lineEl.style.backgroundColor = 'transparent';
            }
        } else {
            if (index === 0 || index === grid.cols) {
                return; // Keine Anpassung für äußerste vertikale Linien
            }
            // Für vertikale Linien
            const relevantCells = grid.cells.filter(cell => {
                if (index > 0) {
                    // Innere vertikale Linie
                    return cell.col < index && cell.col + cell.colSpan > index;
                }
                return false;
            });

            if (relevantCells.length > 0) {
                lineEl.style.borderLeft = '2px dashed var(--interactive-accent)';
                lineEl.style.backgroundColor = 'transparent';
            }
        }
    }

    private createHorizontalLineSegment(
        lineIndex: number,
        yPosition: number,
        x: number,
        width: number,
        block: Block
    ): HTMLElement {
        const lineEl = document.createElement('div');
        lineEl.className = `grid-line horizontal-line segment`;
        lineEl.dataset.lineType = 'horizontal';
        lineEl.dataset.lineIndex = lineIndex.toString();
        lineEl.dataset.blockId = block.id;
        lineEl.dataset.segmentX = x.toString();
        lineEl.dataset.segmentWidth = width.toString();

        const isSelected = this.selectedLine?.type === 'horizontal' &&
            this.selectedLine?.index === lineIndex;

        lineEl.style.position = 'absolute';
        lineEl.style.top = `${yPosition}px`;
        lineEl.style.left = `${x}px`;
        lineEl.style.width = `${width}px`;
        lineEl.style.height = '2px';
        lineEl.style.backgroundColor = isSelected ? 'var(--text-accent)' : 'var(--interactive-accent)';
        lineEl.style.opacity = isSelected ? '0.9' : '0.6';
        lineEl.style.cursor = 'ns-resize';
        lineEl.style.zIndex = '10';
        lineEl.style.pointerEvents = 'auto';

        this.setupGridLineEvents(lineEl, 'horizontal', lineIndex, block);
        return lineEl;
    }

    private createVerticalLineSegment(
        lineIndex: number,
        xPosition: number,
        y: number,
        height: number,
        block: Block
    ): HTMLElement {
        const lineEl = document.createElement('div');
        lineEl.className = `grid-line vertical-line segment`;
        lineEl.dataset.lineType = 'vertical';
        lineEl.dataset.lineIndex = lineIndex.toString();
        lineEl.dataset.blockId = block.id;
        lineEl.dataset.segmentY = y.toString();
        lineEl.dataset.segmentHeight = height.toString();

        const isSelected = this.selectedLine?.type === 'vertical' &&
            this.selectedLine?.index === lineIndex;

        lineEl.style.position = 'absolute';
        lineEl.style.left = `${xPosition}px`;
        lineEl.style.top = `${y}px`;
        lineEl.style.width = '2px';
        lineEl.style.height = `${height}px`;
        lineEl.style.backgroundColor = isSelected ? 'var(--text-accent)' : 'var(--interactive-accent)';
        lineEl.style.opacity = isSelected ? '0.9' : '0.6';
        lineEl.style.cursor = 'ew-resize';
        lineEl.style.zIndex = '10';
        lineEl.style.pointerEvents = 'auto';

        this.setupGridLineEvents(lineEl, 'vertical', lineIndex, block);
        return lineEl;
    }

    private getColWidthSum(grid: TableGrid, startCol: number, endCol: number): number {
        let sum = 0;
        for (let i = startCol; i <= endCol; i++) {
            if (grid.colWidths[i] !== undefined) {
                sum += grid.colWidths[i]!;
            }
        }
        return sum;
    }

    private getRowHeightSum(grid: TableGrid, startRow: number, endRow: number): number {
        let sum = 0;
        for (let i = startRow; i <= endRow; i++) {
            if (grid.rowHeights[i] !== undefined) {
                sum += grid.rowHeights[i]!;
            }
        }
        return sum;
    }

    private createCellOverlays(
        overlay: HTMLElement,
        grid: TableGrid,
        block: Block,
        canvasWidth: number,
        canvasHeight: number
    ): void {
        // Berechne das Verhältnis zwischen Canvas-Größe und Block-Größe
        const widthRatio = canvasWidth / block.bbox.width;
        const heightRatio = canvasHeight / block.bbox.height;

        let currentY = 0;

        for (let row = 0; row < grid.rows; row++) {
            let currentX = 0;
            const rowHeight = grid.rowHeights[row];

            for (let col = 0; col < grid.cols; col++) {
                const colWidth = grid.colWidths[col];

                // Finde die Zelle an dieser Position
                const cell = grid.cells.find(c =>
                    c.row === row && c.col === col &&
                    c.rowSpan === 1 && c.colSpan === 1
                );

                if (cell && colWidth !== undefined && rowHeight !== undefined) {
                    const cellOverlay = document.createElement('div');
                    cellOverlay.className = 'table-cell-overlay';
                    cellOverlay.style.position = 'absolute';
                    cellOverlay.style.left = `${currentX * widthRatio}px`;
                    cellOverlay.style.top = `${currentY * heightRatio}px`;
                    cellOverlay.style.width = `${colWidth * widthRatio}px`;
                    cellOverlay.style.height = `${rowHeight * heightRatio}px`;
                    cellOverlay.style.border = '1px dashed rgba(var(--interactive-accent-rgb), 0.3)';
                    cellOverlay.style.boxSizing = 'border-box';
                    cellOverlay.style.pointerEvents = 'auto';
                    cellOverlay.style.cursor = 'pointer';
                    cellOverlay.style.zIndex = '8';
                    cellOverlay.dataset.row = row.toString();
                    cellOverlay.dataset.col = col.toString();
                    cellOverlay.dataset.blockId = block.id;

                    // Event Listener für Zellen-Merge
                    this.setupCellEvents(cellOverlay, row, col, block);

                    overlay.appendChild(cellOverlay);
                }

                if (colWidth !== undefined) currentX += colWidth;
            }

            if (rowHeight !== undefined) currentY += rowHeight;
        }
    }

    private setupGridLineEvents(lineEl: HTMLElement, type: 'horizontal' | 'vertical', index: number, block: Block): void {
        if (!block.tableGrid) return;

        const grid = block.tableGrid;

        // KEINE Einschränkungen mehr - ALLE Linien können verschoben werden
        this.setupLineDragging(lineEl, type, index, block);

        // Doppelklick zum Löschen - für ALLE Linien
        lineEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            e.preventDefault();

            // Entferne die Bestätigungsabfrage - einfach löschen
            this.removeGridLine(block.id, type, index);
        });

        // Klick zum Auswählen (für Bewegung mit Pfeiltasten)
        lineEl.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            // Linie auswählen für Tastatursteuerung
            this.selectedLine = { type, index };

            // Visuelles Feedback
            const allLines = lineEl.closest('.table-grid-overlay')?.querySelectorAll('.grid-line');
            if (allLines) {
                allLines.forEach((l: Element) => {
                    const line = l as HTMLElement;
                    if (line.dataset.isBoundary !== 'true') {
                        line.style.opacity = '0.6';
                        line.style.backgroundColor = 'var(--interactive-accent)';
                    }
                });
            }

            lineEl.style.opacity = '0.9';
            lineEl.style.backgroundColor = 'var(--text-accent)';
        });
    }

    private setupLineDragging(lineEl: HTMLElement, type: 'horizontal' | 'vertical', index: number, block: Block): void {
        let isDragging = false;
        let dragStartPosition = 0;
        let originalLinePosition = 0;

        lineEl.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();

            // Verhindere Drag auf Grenzlinien
            if (lineEl.dataset.isBoundary === 'true') return;

            isDragging = true;

            // Holen des Canvas-Elements und dessen Position
            const canvas = lineEl.closest('.ink-block')?.querySelector('canvas') as HTMLCanvasElement;
            if (!canvas) return;

            const canvasRect = canvas.getBoundingClientRect();

            // Berechne die Mausposition relativ zum Canvas
            if (type === 'horizontal') {
                const mouseY = e.clientY - canvasRect.top;
                dragStartPosition = mouseY;
                originalLinePosition = parseFloat(lineEl.style.top);
            } else {
                const mouseX = e.clientX - canvasRect.left;
                dragStartPosition = mouseX;
                originalLinePosition = parseFloat(lineEl.style.left);
            }

            lineEl.classList.add('dragging');

            // Globalen Event-Listener für Mousemove und Mouseup hinzufügen
            const handleMouseMove = (moveEvent: MouseEvent) => {
                if (!isDragging) return;

                const currentCanvas = lineEl.closest('.ink-block')?.querySelector('canvas') as HTMLCanvasElement;
                if (!currentCanvas) return;

                const currentCanvasRect = currentCanvas.getBoundingClientRect();

                if (type === 'horizontal') {
                    const currentMouseY = moveEvent.clientY - currentCanvasRect.top;
                    const delta = currentMouseY - dragStartPosition;
                    const newPosition = originalLinePosition + delta;
                    lineEl.style.top = `${newPosition}px`;
                } else {
                    const currentMouseX = moveEvent.clientX - currentCanvasRect.left;
                    const delta = currentMouseX - dragStartPosition;
                    const newPosition = originalLinePosition + delta;
                    lineEl.style.left = `${newPosition}px`;
                }

                moveEvent.stopPropagation();
            };

            const handleMouseUp = (upEvent: MouseEvent) => {
                if (!isDragging) return;

                isDragging = false;
                lineEl.classList.remove('dragging');

                const finalCanvas = lineEl.closest('.ink-block')?.querySelector('canvas') as HTMLCanvasElement;
                if (!finalCanvas) return;

                const finalCanvasRect = finalCanvas.getBoundingClientRect();
                const blockEl = finalCanvas.closest('.ink-block');
                if (!blockEl) return;

                if (type === 'horizontal') {
                    const finalMouseY = upEvent.clientY - finalCanvasRect.top;
                    const delta = finalMouseY - dragStartPosition;
                    const finalCanvasPosition = originalLinePosition + delta;

                    const canvasHeight = finalCanvasRect.height;
                    const blockHeight = block.bbox.height;
                    const finalBlockPosition = (finalCanvasPosition / canvasHeight) * blockHeight;

                    this.updateGridAfterLineMove(block.id, type, index, finalBlockPosition);
                } else {
                    const finalMouseX = upEvent.clientX - finalCanvasRect.left;
                    const delta = finalMouseX - dragStartPosition;
                    const finalCanvasPosition = originalLinePosition + delta;

                    const canvasWidth = finalCanvasRect.width;
                    const blockWidth = block.bbox.width;
                    const finalBlockPosition = (finalCanvasPosition / canvasWidth) * blockWidth;

                    this.updateGridAfterLineMove(block.id, type, index, finalBlockPosition);
                }

                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);

                upEvent.stopPropagation();
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });
    }

    public removeGridLine(blockId: string, type: 'horizontal' | 'vertical', index: number): void {
        const block = this.context.blocks.find(b => b.id === blockId);
        if (!block || !block.tableGrid) return;

        const grid = block.tableGrid;

        // Für horizontale Linien (Zeilen)
        if (type === 'horizontal') {
            // Wenn die Tabelle nur eine Zeile hat, können wir sie nicht löschen
            if (grid.rows <= 1) {
                new Notice("Cannot remove the last row");
                return;
            }

            if (index >= 0 && index < grid.rows) {
                // Entferne Zeilenhöhe
                const removedHeight = grid.rowHeights.splice(index, 1)[0];
                grid.rows -= 1;

                // Passe Zellen an
                // 1. Entferne Zellen in der gelöschten Zeile
                grid.cells = grid.cells.filter(cell => cell.row !== index);

                // 2. Verschiebe Zellen unter der gelöschten Zeile nach oben
                for (const cell of grid.cells) {
                    if (cell.row > index) {
                        cell.row -= 1;
                    }
                }

                // 3. Passe rowSpan von Zellen an, die über die gelöschte Zeile gingen
                for (const cell of grid.cells) {
                    if (cell.row < index && cell.row + cell.rowSpan > index) {
                        cell.rowSpan -= 1;
                        // Wenn rowSpan 0 wird, entferne die Zelle
                        if (cell.rowSpan < 1) {
                            grid.cells = grid.cells.filter(c => c.id !== cell.id);
                        }
                    }
                }

                // Block-Größe anpassen
                if (removedHeight) block.bbox.height -= removedHeight;
            }
        } else {
            // Für vertikale Linien (Spalten)
            if (grid.cols <= 1) {
                new Notice("Cannot remove the last column");
                return;
            }

            if (index >= 0 && index < grid.cols) {
                // Entferne Spaltenbreite
                const removedWidth = grid.colWidths.splice(index, 1)[0];
                grid.cols -= 1;

                // Passe Zellen an
                // 1. Entferne Zellen in der gelöschten Spalte
                grid.cells = grid.cells.filter(cell => cell.col !== index);

                // 2. Verschiebe Zellen rechts der gelöschten Spalte nach links
                for (const cell of grid.cells) {
                    if (cell.col > index) {
                        cell.col -= 1;
                    }
                }

                // 3. Passe colSpan von Zellen an, die über die gelöschte Spalte gingen
                for (const cell of grid.cells) {
                    if (cell.col < index && cell.col + cell.colSpan > index) {
                        cell.colSpan -= 1;
                        // Wenn colSpan 0 wird, entferne die Zelle
                        if (cell.colSpan < 1) {
                            grid.cells = grid.cells.filter(c => c.id !== cell.id);
                        }
                    }
                }

                // Block-Größe anpassen
                if (removedWidth) block.bbox.width -= removedWidth;
            }
        }

        this.context.blockManager.renderBlocks();
        new Notice(`${type === 'horizontal' ? 'Row' : 'Column'} removed`);
    }

    private updateGridAfterLineMove(blockId: string, lineType: 'horizontal' | 'vertical', lineIndex: number, newPixelPosition: number): void {
        const block = this.context.blocks.find(b => b.id === blockId);
        if (!block || !block.tableGrid) return;

        const grid = block.tableGrid;
        const MIN_SIZE = 20;

        if (lineType === 'horizontal') {
            // Berechne kumulative Höhe bis zur Linie
            let cumulativeHeight = 0;
            for (let i = 0; i < lineIndex; i++) {
                if (grid.rowHeights[i] !== undefined) {
                    cumulativeHeight += grid.rowHeights[i]!;
                }
            }

            // Delta berechnen
            const delta = newPixelPosition - cumulativeHeight;

            // Aktualisiere die Höhen der betroffenen Zeilen
            if (lineIndex > 0 && lineIndex < grid.rows) {
                // Innere Linie: teile Höhe zwischen zwei Zeilen auf
                const prevHeight = grid.rowHeights[lineIndex - 1];
                const currHeight = grid.rowHeights[lineIndex];

                if (prevHeight !== undefined && currHeight !== undefined) {
                    let newPrevHeight = prevHeight + delta;
                    let newCurrHeight = currHeight - delta;

                    // Mindestgröße sicherstellen
                    if (newPrevHeight < MIN_SIZE) {
                        newCurrHeight += (newPrevHeight - MIN_SIZE);
                        newPrevHeight = MIN_SIZE;
                    }
                    if (newCurrHeight < MIN_SIZE) {
                        newPrevHeight += (newCurrHeight - MIN_SIZE);
                        newCurrHeight = MIN_SIZE;
                    }

                    grid.rowHeights[lineIndex - 1] = newPrevHeight;
                    grid.rowHeights[lineIndex] = newCurrHeight;
                }
            } else if (lineIndex === 0) {
                // Erste Linie: nur die erste Zeilenhöhe anpassen
                if (grid.rowHeights[0] !== undefined) {
                    const newHeight = grid.rowHeights[0]! + delta;
                    grid.rowHeights[0] = Math.max(MIN_SIZE, newHeight);
                }
            } else if (lineIndex === grid.rows) {
                // Letzte Linie: nur die letzte Zeilenhöhe anpassen
                if (grid.rowHeights[grid.rows - 1] !== undefined) {
                    const newHeight = grid.rowHeights[grid.rows - 1]! + delta;
                    grid.rowHeights[grid.rows - 1] = Math.max(MIN_SIZE, newHeight);
                }
            }
        } else {
            // Ähnlich für vertikale Linien
            let cumulativeWidth = 0;
            for (let i = 0; i < lineIndex; i++) {
                if (grid.colWidths[i] !== undefined) {
                    cumulativeWidth += grid.colWidths[i]!;
                }
            }

            const delta = newPixelPosition - cumulativeWidth;

            if (lineIndex > 0 && lineIndex < grid.cols) {
                const prevWidth = grid.colWidths[lineIndex - 1];
                const currWidth = grid.colWidths[lineIndex];

                if (prevWidth !== undefined && currWidth !== undefined) {
                    let newPrevWidth = prevWidth + delta;
                    let newCurrWidth = currWidth - delta;

                    if (newPrevWidth < MIN_SIZE) {
                        newCurrWidth += (newPrevWidth - MIN_SIZE);
                        newPrevWidth = MIN_SIZE;
                    }
                    if (newCurrWidth < MIN_SIZE) {
                        newPrevWidth += (newCurrWidth - MIN_SIZE);
                        newCurrWidth = MIN_SIZE;
                    }

                    grid.colWidths[lineIndex - 1] = newPrevWidth;
                    grid.colWidths[lineIndex] = newCurrWidth;
                }
            } else if (lineIndex === 0) {
                // Erste Linie
                if (grid.colWidths[0] !== undefined) {
                    const newWidth = grid.colWidths[0]! + delta;
                    grid.colWidths[0] = Math.max(MIN_SIZE, newWidth);
                }
            } else if (lineIndex === grid.cols) {
                // Letzte Linie
                if (grid.colWidths[grid.cols - 1] !== undefined) {
                    const newWidth = grid.colWidths[grid.cols - 1]! + delta;
                    grid.colWidths[grid.cols - 1] = Math.max(MIN_SIZE, newWidth);
                }
            }
        }

        // Block-Größe anpassen
        this.adjustBlockSizeAfterGridChange(block);

        // Neu rendern
        setTimeout(() => {
            this.context.blockManager.renderBlocks();
        }, 10);
    }

    private adjustBlockSizeAfterGridChange(block: Block): void {
        if (!block.tableGrid) return;

        const grid = block.tableGrid;

        // Berechne benötigte Größe basierend auf sichtbaren Linien und Inhalten
        let totalHeight = 40; // Padding
        let totalWidth = 40; // Padding

        // Berechne Höhe basierend auf Zeilen
        for (let i = 0; i < grid.rows; i++) {
            if (grid.rowHeights[i] !== undefined) {
                totalHeight += grid.rowHeights[i]!;
            }
        }

        // Berechne Breite basierend auf Spalten
        for (let i = 0; i < grid.cols; i++) {
            if (grid.colWidths[i] !== undefined) {
                totalWidth += grid.colWidths[i]!;
            }
        }

        // Prüfe ob Inhalt bis an den Rand reicht
        let hasContentAtRight = false;
        let hasContentAtBottom = false;

        if (this.context.document) {
            for (const strokeId of block.strokeIds) {
                const stroke = this.context.document.getStroke(strokeId);
                if (stroke) {
                    for (const point of stroke.points) {
                        // Prüfe ob Punkt nahe am rechten Rand ist
                        if (point.x > block.bbox.width * 0.9) {
                            hasContentAtRight = true;
                        }
                        // Prüfe ob Punkt nahe am unteren Rand ist
                        if (point.y > block.bbox.height * 0.9) {
                            hasContentAtBottom = true;
                        }
                    }
                }
            }
        }

        // Wenn kein Inhalt am rechten Rand, reduziere Breite
        if (!hasContentAtRight && block.bbox.width > totalWidth + 50) {
            block.bbox.width = Math.max(totalWidth + 50, 760); // Mindestbreite
        }

        // Wenn kein Inhalt am unteren Rand, reduziere Höhe
        if (!hasContentAtBottom && block.bbox.height > totalHeight + 50) {
            block.bbox.height = Math.max(totalHeight + 50, 200); // Mindesthöhe
        }

        // Aktualisiere Canvas-Größe
        const canvas = this.context.blockManager.getCanvasForBlock(block.id);
        if (canvas) {
            this.context.drawingManager.resizeCanvas(canvas, block);
        }
    }

    private updateLineSelection(block: Block): void {
        const blockEl = this.context.blocksContainer?.querySelector(`.ink-block[data-block-id="${block.id}"]`);
        if (!blockEl) return;

        // Alle Linien deselektieren
        const allLines = blockEl.querySelectorAll('.grid-line');
        allLines.forEach((lineElement) => {
            const lineEl = lineElement as HTMLElement;
            lineEl.style.opacity = '0.6';
            lineEl.style.backgroundColor = 'var(--interactive-accent)';
        });

        // Ausgewählte Linie hervorheben
        if (this.selectedLine) {
            const selectedLineElement = blockEl.querySelector(
                `.grid-line[data-line-type="${this.selectedLine.type}"][data-line-index="${this.selectedLine.index}"]`
            );
            if (selectedLineElement) {
                const selectedLine = selectedLineElement as HTMLElement;
                selectedLine.style.opacity = '1';
                selectedLine.style.backgroundColor = 'var(--text-accent)';
            }
        }
    }

    public moveGridLine(blockId: string, lineType: 'horizontal' | 'vertical', lineIndex: number, newPosition: number): void {
        const block = this.context.blocks.find(b => b.id === blockId);
        if (!block || !block.tableGrid) return;

        const grid = block.tableGrid;
        const MIN_SIZE = 20;

        if (lineType === 'horizontal') {
            // Überprüfe, ob die neue Position gültig ist
            const prevHeight = lineIndex > 0 ? grid.rowHeights[lineIndex - 1] : 0;
            const nextHeight = lineIndex < grid.rows - 1 ? grid.rowHeights[lineIndex + 1] : Infinity;

            // Stelle sicher, dass die Zeilenhöhe innerhalb der Grenzen bleibt
            if (grid.rowHeights[lineIndex] === undefined || nextHeight === undefined) return;
            const newHeight = Math.max(MIN_SIZE, Math.min(newPosition, grid.rowHeights[lineIndex] + nextHeight - MIN_SIZE));
            grid.rowHeights[lineIndex] = newHeight;
        } else {
            // Ähnliche Logik für vertikale Linien
            const prevWidth = lineIndex > 0 ? grid.colWidths[lineIndex - 1] : 0;
            const nextWidth = lineIndex < grid.cols - 1 ? grid.colWidths[lineIndex + 1] : Infinity;

            if (grid.colWidths[lineIndex] === undefined || nextWidth === undefined) return;
            const newWidth = Math.max(MIN_SIZE, Math.min(newPosition, grid.colWidths[lineIndex] + nextWidth - MIN_SIZE));
            grid.colWidths[lineIndex] = newWidth;
        }

        this.context.blockManager.renderBlocks();
    }

    // Neue Methode für präzises Hinzufügen von Linien
    public addGridLineAtPosition(blockId: string, type: 'horizontal' | 'vertical', position: number): void {
        const block = this.context.blocks.find(b => b.id === blockId);
        if (!block || !block.tableGrid) return;

        const grid = block.tableGrid;
        const MIN_SIZE = 20;

        if (type === 'horizontal') {
            // Finde die Zeile, in der die Position liegt
            let accumulatedHeight = 0;
            let insertIndex = grid.rows;

            for (let i = 0; i < grid.rows; i++) {
                if (grid.rowHeights[i] === undefined) continue;
                accumulatedHeight += grid.rowHeights[i]!;
                if (position < accumulatedHeight - MIN_SIZE) {
                    insertIndex = i;
                    break;
                }
            }

            // Teile die Zeile an der Position
            const rowIndex = Math.max(0, Math.min(insertIndex, grid.rows - 1));
            const rowHeight = grid.rowHeights[rowIndex];
            if (rowHeight === undefined) return;
            const splitRatio = (position - (accumulatedHeight - rowHeight)) / rowHeight;

            if (splitRatio > 0.1 && splitRatio < 0.9) { // Nur teilen, wenn nicht zu nah am Rand
                const newHeight1 = rowHeight * splitRatio;
                const newHeight2 = rowHeight * (1 - splitRatio);

                grid.rowHeights[rowIndex] = newHeight1;
                grid.rowHeights.splice(rowIndex + 1, 0, newHeight2);
                grid.rows += 1;

                // Zellen anpassen
                this.adjustCellsForNewRow(grid, rowIndex);

                this.context.blockManager.renderBlocks();
            }
        } else {
            // Ähnliche Logik für vertikale Linien
            let accumulatedWidth = 0;
            let insertIndex = grid.cols;

            for (let i = 0; i < grid.cols; i++) {
                if (grid.colWidths[i] === undefined) continue;
                accumulatedWidth += grid.colWidths[i]!;
                if (position < accumulatedWidth - MIN_SIZE) {
                    insertIndex = i;
                    break;
                }
            }

            const colIndex = Math.max(0, Math.min(insertIndex, grid.cols - 1));
            const colWidth = grid.colWidths[colIndex];
            if (colWidth === undefined) return;
            const splitRatio = (position - (accumulatedWidth - colWidth)) / colWidth;

            if (splitRatio > 0.1 && splitRatio < 0.9) {
                const newWidth1 = colWidth * splitRatio;
                const newWidth2 = colWidth * (1 - splitRatio);

                grid.colWidths[colIndex] = newWidth1;
                grid.colWidths.splice(colIndex + 1, 0, newWidth2);
                grid.cols += 1;

                this.adjustCellsForNewColumn(grid, colIndex);

                this.context.blockManager.renderBlocks();
            }
        }
    }

    private adjustCellsForNewRow(grid: TableGrid, rowIndex: number): void {
        // Passe Zellen an, die sich über die neue Zeile erstrecken
        for (const cell of grid.cells) {
            if (cell.row <= rowIndex && cell.row + cell.rowSpan > rowIndex) {
                // Zelle erstreckt sich über die neue Zeile - erweitere rowSpan
                cell.rowSpan += 1;
            } else if (cell.row > rowIndex) {
                // Zelle ist unter der neuen Zeile - verschiebe nach unten
                cell.row += 1;
            }
        }

        // Füge neue Zellen für die neue Zeile hinzu
        for (let col = 0; col < grid.cols; col++) {
            grid.cells.push({
                id: crypto.randomUUID(),
                row: rowIndex + 1,
                col,
                rowSpan: 1,
                colSpan: 1
            });
        }
    }

    private adjustCellsForNewColumn(grid: TableGrid, colIndex: number): void {
        // Ähnliche Logik für Spalten
        for (const cell of grid.cells) {
            if (cell.col <= colIndex && cell.col + cell.colSpan > colIndex) {
                cell.colSpan += 1;
            } else if (cell.col > colIndex) {
                cell.col += 1;
            }
        }

        for (let row = 0; row < grid.rows; row++) {
            grid.cells.push({
                id: crypto.randomUUID(),
                row,
                col: colIndex + 1,
                rowSpan: 1,
                colSpan: 1
            });
        }
    }

    private setupCellEvents(cellEl: HTMLElement, row: number, col: number, block: Block): void {
        if (!block.tableGrid) return;

        cellEl.addEventListener('click', (e) => {
            e.stopPropagation();

            if (!this.mergeStartCell) {
                // Erste Zelle auswählen
                this.mergeStartCell = { row, col };
                cellEl.style.backgroundColor = 'rgba(var(--interactive-accent-rgb), 0.3)';
                cellEl.style.border = '2px solid var(--interactive-accent)';
            } else {
                // Zweite Zelle für Merge
                const start = this.mergeStartCell;
                const end = { row, col };

                // Merge durchführen
                this.mergeTableCells(block.id, start, end);

                // Reset
                this.mergeStartCell = null;
                this.context.toolbarManager.setTableMode(null);
            }
        });
    }

    public handleCanvasClickForTable(block: Block, x: number, y: number): boolean {
        const tableMode = this.context.toolbarManager.getCurrentTableMode();
        if (!tableMode || block.type !== 'table') return false;

        // Stelle sicher, dass eine Tabelle existiert
        if (!block.tableGrid) {
            this.initializeTableBlock(block.id, 1, 1);
            return true;
        }

        const grid = block.tableGrid!;
        const MARGIN_THRESHOLD = 20;

        // Prüfe, ob Klick nahe am Rand ist
        const isNearLeft = x < MARGIN_THRESHOLD;
        const isNearRight = x > block.bbox.width - MARGIN_THRESHOLD;
        const isNearTop = y < MARGIN_THRESHOLD;
        const isNearBottom = y > block.bbox.height - MARGIN_THRESHOLD;

        // Wenn im Linien-Modus, füge neue Linie hinzu
        if (tableMode === 'vertical-line') {
            let insertIndex: number = grid.cols;

            if (isNearLeft) {
                // Füge Spalte am Anfang ein
                insertIndex = 0;
            } else if (isNearRight) {
                // Füge Spalte am Ende ein
                insertIndex = grid.cols;
            } else {
                // Finde die beste Position für eine neue vertikale Linie
                let currentX = 0;
                for (let c = 0; c <= grid.cols; c++) {
                    const colWidth = c < grid.cols ? grid.colWidths[c] : 0;
                    if (colWidth === undefined && c < grid.cols) continue;

                    const nextX = currentX + (colWidth || 0);

                    if (x >= currentX && x <= nextX) {
                        const midPoint = currentX + (nextX - currentX) / 2;
                        insertIndex = x < midPoint ? c : c + 1;
                        break;
                    }

                    currentX = nextX;
                }
            }

            // Füge Spalte an der Position ein
            this.insertTableColumn(block.id, insertIndex);
            return true;

        } else if (tableMode === 'horizontal-line') {
            let insertIndex: number = grid.rows;

            if (isNearTop) {
                // Füge Zeile am Anfang ein
                insertIndex = 0;
            } else if (isNearBottom) {
                // Füge Zeile am Ende ein
                insertIndex = grid.rows;
            } else {
                // Finde die beste Position für eine neue horizontale Linie
                let currentY = 0;
                for (let r = 0; r <= grid.rows; r++) {
                    const rowHeight = r < grid.rows ? grid.rowHeights[r] : 0;
                    if (rowHeight === undefined && r < grid.rows) continue;

                    const nextY = currentY + (rowHeight || 0);

                    if (y >= currentY && y <= nextY) {
                        const midPoint = currentY + (nextY - currentY) / 2;
                        insertIndex = y < midPoint ? r : r + 1;
                        break;
                    }

                    currentY = nextY;
                }
            }

            // Füge Zeile an der Position ein
            this.insertTableRow(block.id, insertIndex);
            return true;
        }

        return false;
    }

    public removeSelectedLine(): void {
        if (!this.selectedLine) return;

        const currentBlock = this.context.blocks[this.context.currentBlockIndex];
        if (!currentBlock || currentBlock.type !== 'table') return;

        this.selectedLine = null;
    }

    public initializeTableBlock(blockId: string, rows: number = 3, cols: number = 3): void {
        const blockIndex = this.context.blocks.findIndex(b => b.id === blockId);
        if (blockIndex === -1) return;

        const block = this.context.blocks[blockIndex];
        if (!block) return;
        if (block.type !== 'table') return;

        const DEFAULT_ROW_HEIGHT = 80;
        const DEFAULT_COL_WIDTH = 150;

        const rowHeights = Array(rows).fill(DEFAULT_ROW_HEIGHT);
        const colWidths = Array(cols).fill(DEFAULT_COL_WIDTH);

        const cells: TableCell[] = [];
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                cells.push({
                    id: crypto.randomUUID(),
                    row,
                    col,
                    rowSpan: 1,
                    colSpan: 1
                });
            }
        }

        block.tableGrid = {
            id: crypto.randomUUID(),
            rows,
            cols,
            rowHeights,
            colWidths,
            cells
        };

        // Block-Größe setzen
        const totalHeight = rowHeights.reduce((a, b) => a + b, 0) + 40;
        const totalWidth = colWidths.reduce((a, b) => a + b, 0) + 40;

        block.bbox.width = Math.max(block.bbox.width, totalWidth);
        block.bbox.height = Math.max(block.bbox.height, totalHeight);

        this.context.blockManager.renderBlocks();
    }

    public insertTableRow(blockId: string, rowIndex: number): void {
        const block = this.context.blocks.find(b => b.id === blockId);
        if (!block || !block.tableGrid) {
            console.error('Block nicht gefunden oder kein tableGrid:', blockId);
            return;
        }

        const grid = block.tableGrid;
        const DEFAULT_HEIGHT = 80;

        console.log('Inserting row at index:', rowIndex, 'Grid rows before:', grid.rows);

        // Zeile einfügen
        grid.rowHeights.splice(rowIndex, 0, DEFAULT_HEIGHT);
        grid.rows += 1;

        // Zellen anpassen: Alle Zellen, die in oder nach der eingefügten Zeile sind, müssen angepasst werden
        for (let i = 0; i < grid.cells.length; i++) {
            const cell = grid.cells[i];
            if (cell === undefined) continue;
            if (cell.row >= rowIndex) {
                cell.row += 1;
            }
        }

        // Neue Zellen für die neue Zeile hinzufügen
        for (let col = 0; col < grid.cols; col++) {
            grid.cells.push({
                id: crypto.randomUUID(),
                row: rowIndex,
                col,
                rowSpan: 1,
                colSpan: 1
            });
        }

        // Block-Größe anpassen
        const totalHeight = grid.rowHeights.reduce((a, b) => a + b, 0) + 40;
        block.bbox.height = Math.max(block.bbox.height, totalHeight);

        console.log('Grid rows after:', grid.rows, 'Total height:', totalHeight);

        this.context.blockManager.renderBlocks();
    }

    public insertTableColumn(blockId: string, colIndex: number): void {
        const block = this.context.blocks.find(b => b.id === blockId);
        if (!block || !block.tableGrid) {
            console.error('Block nicht gefunden oder kein tableGrid:', blockId);
            return;
        }

        const grid = block.tableGrid;
        const DEFAULT_WIDTH = 150;

        console.log('Inserting column at index:', colIndex, 'Grid cols before:', grid.cols);

        // Spalte einfügen
        grid.colWidths.splice(colIndex, 0, DEFAULT_WIDTH);
        grid.cols += 1;

        // Zellen anpassen
        for (let i = 0; i < grid.cells.length; i++) {
            const cell = grid.cells[i];
            if (cell === undefined) continue;
            if (cell.col >= colIndex) {
                cell.col += 1;
            }
        }

        // Neue Zellen für die neue Spalte hinzufügen
        for (let row = 0; row < grid.rows; row++) {
            grid.cells.push({
                id: crypto.randomUUID(),
                row,
                col: colIndex,
                rowSpan: 1,
                colSpan: 1
            });
        }

        // Block-Größe anpassen
        const totalWidth = grid.colWidths.reduce((a, b) => a + b, 0) + 40;
        block.bbox.width = Math.max(block.bbox.width, totalWidth);

        console.log('Grid cols after:', grid.cols, 'Total width:', totalWidth);

        this.context.blockManager.renderBlocks();
    }

    public mergeTableCells(blockId: string, start: { row: number, col: number }, end: { row: number, col: number }): void {
        const block = this.context.blocks.find(b => b.id === blockId);
        if (!block || !block.tableGrid) return;

        const grid = block.tableGrid;

        // Sortiere Start und End
        const startRow = Math.min(start.row, end.row);
        const endRow = Math.max(start.row, end.row);
        const startCol = Math.min(start.col, end.col);
        const endCol = Math.max(start.col, end.col);

        const rowSpan = endRow - startRow + 1;
        const colSpan = endCol - startCol + 1;

        // Finde die Hauptzelle (obere linke)
        const mainCellIndex = grid.cells.findIndex(c => c.row === startRow && c.col === startCol);
        if (mainCellIndex === -1) return;

        // Aktualisiere die Hauptzelle
        if (grid.cells[mainCellIndex] === undefined) return;
        grid.cells[mainCellIndex].rowSpan = rowSpan;
        grid.cells[mainCellIndex].colSpan = colSpan;

        // Entferne die anderen Zellen im Merge-Bereich
        grid.cells = grid.cells.filter(cell => {
            if (cell.row >= startRow && cell.row <= endRow &&
                cell.col >= startCol && cell.col <= endCol) {
                // Behalte nur die Hauptzelle
                return cell.row === startRow && cell.col === startCol;
            }
            return true;
        });

        this.context.blockManager.renderBlocks();
        new Notice('Cells merged');
    }

    public setTableToolMode(mode: 'add-line' | 'move-line' | 'merge-cells' | null): void {
        this.tableToolMode = mode;
        this.mergeStartCell = null;
        this.selectedLine = null;
        this.context.blockManager.renderBlocks();
    }

    public getTableToolMode(): 'add-line' | 'move-line' | 'merge-cells' | null {
        return this.tableToolMode;
    }

    public getSelectedLine(): { type: 'horizontal' | 'vertical', index: number } | null {
        return this.selectedLine;
    }
}