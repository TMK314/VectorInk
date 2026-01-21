import { table } from 'console';
import { Block, BlockType, PartialBlock, BoundingBox, TableLine, TableCell, TableGrid } from '../types';
import { InkView } from './InkView';
import { Notice } from 'obsidian';
import { start } from 'repl';

export class BlockManager {
    private context: InkView;
    private selectedLine: { type: 'horizontal' | 'vertical', index: number } | null = null;
    private isDraggingLine = false;
    private dragStartPosition = { x: 0, y: 0 };
    private dragStartLinePosition = 0;
    private mergeStartCell: { row: number, col: number } | null = null;
    private isMovingLine = false;
    private isMergingCells = false; // Nur für Zellenzusammenführung
    private tableToolMode: 'add-line' | 'move-line' | 'merge-cells' | null = null;
    private lineDragStartPosition = 0; // Startposition beim Ziehen
    private lineDragStartIndex = 0; // Start-Index beim Ziehen
    private animationFrameId: number | null = null;
    private lastClickTime = 0; // Für Doppelklick-Erkennung

    constructor(context: InkView) {
        this.context = context;
    }

    public renderBlocks(): void {
        if (!this.context.blocksContainer) return;

        this.context.blocksContainer.empty();
        this.context.blocks.sort((a, b) => a.order - b.order);

        this.context.blocks.forEach((block, index) => {
            const blockElement = this.createBlockElement(block, index);
            this.context.blocksContainer!.appendChild(blockElement);

            // Overlay verzögert hinzufügen
            if (block.type === 'table' && block.tableGrid) {
                setTimeout(() => {
                    // Prüfe ob das Element noch existiert
                    const currentBlockEl = document.querySelector(`.ink-block[data-block-id="${block.id}"]`);
                    if (currentBlockEl && document.body.contains(currentBlockEl)) {
                        this.createTableGridOverlay(currentBlockEl as HTMLElement, block);
                    }
                }, 10);
            }
        });

        // Tabellen-Tools Sichtbarkeit aktualisieren
        setTimeout(() => {
            if (this.context.toolbarManager) {
                this.context.toolbarManager.updateTableToolsVisibility();
            }
        }, 20);
    }

    private createBlockElement(block: Block, index: number): HTMLElement {
        const isSelected = index === this.context.currentBlockIndex;

        const blockEl = document.createElement('div');
        blockEl.className = 'ink-block';
        blockEl.dataset.blockId = block.id;
        blockEl.dataset.selected = isSelected.toString();
        blockEl.dataset.blockType = block.type;
        blockEl.style.position = 'relative';
        blockEl.style.marginTop = `${isSelected ? Math.max(this.context.blockManager.blockMargins.top, 12) : this.context.blockManager.blockMargins.top}px`;
        blockEl.style.marginBottom = `${isSelected ? Math.max(this.context.blockManager.blockMargins.bottom, 12) : this.context.blockManager.blockMargins.bottom}px`;
        blockEl.style.border = isSelected ? '2px solid var(--interactive-accent)' : '1px solid var(--background-modifier-border)';
        blockEl.style.borderRadius = '6px';
        blockEl.style.background = 'var(--background-primary)';
        blockEl.style.padding = isSelected ? '15px' : '8px';
        blockEl.style.minHeight = isSelected ? '150px' : '100px';
        blockEl.style.transition = 'all 0.2s ease';
        blockEl.style.boxShadow = isSelected ? '0 2px 8px rgba(0,0,0,0.1)' : 'none';

        if (isSelected) {
            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.marginBottom = '10px';
            header.style.paddingBottom = '5px';
            header.style.borderBottom = '1px solid var(--background-modifier-border)';
            header.style.minHeight = '32px';

            const typeSelector = document.createElement('select');
            typeSelector.style.marginRight = '10px';
            typeSelector.style.fontSize = '12px';
            typeSelector.style.padding = '2px 5px';
            typeSelector.style.flex = '1';

            const blockTypes: { value: BlockType, label: string, icon: string }[] = [
                { value: 'paragraph', label: 'Paragraph', icon: '📝' },
                { value: 'heading1', label: 'Heading 1', icon: 'H1' },
                { value: 'heading2', label: 'Heading 2', icon: 'H2' },
                { value: 'heading3', label: 'Heading 3', icon: 'H3' },
                { value: 'heading4', label: 'Heading 4', icon: 'H4' },
                { value: 'heading5', label: 'Heading 5', icon: 'H5' },
                { value: 'math', label: 'Math', icon: '∑' },
                { value: 'quote', label: 'Quote', icon: '❝' },
                { value: 'drawing', label: 'Drawing', icon: '🖼️' },
                { value: 'table', label: 'Table', icon: '📊' }
            ];

            blockTypes.forEach(type => {
                const option = document.createElement('option');
                option.value = type.value;
                option.textContent = `${type.icon} ${type.label}`;
                if (block.type === type.value) option.selected = true;
                typeSelector.appendChild(option);
            });

            typeSelector.onchange = (e) => {
                const newType = (e.target as HTMLSelectElement).value as BlockType;
                block.type = newType;
                this.context.drawingManager.updateBlock({ id: block.id, type: newType });
                this.renderBlocks();
            };

            header.appendChild(typeSelector);

            const controls = document.createElement('div');
            controls.style.display = 'flex';
            controls.style.gap = '5px';
            controls.style.flexShrink = '0';

            const upBtn = this.createBlockControlButton('↑', 'Move up', () => this.moveBlockUp(index));
            upBtn.style.display = index === 0 ? 'none' : 'block';
            controls.appendChild(upBtn);

            const downBtn = this.createBlockControlButton('↓', 'Move down', () => this.moveBlockDown(index));
            downBtn.style.display = index === this.context.blocks.length - 1 ? 'none' : 'block';
            controls.appendChild(downBtn);

            const separator = document.createElement('span');
            separator.style.margin = '0 5px';
            separator.style.color = 'var(--background-modifier-border)';
            separator.textContent = '|';
            controls.appendChild(separator);

            const clearBtn = this.createBlockControlButton('🗑️', 'Clear block', () => this.clearBlock(block.id));
            controls.appendChild(clearBtn);

            const deleteBtn = this.createBlockControlButton('✕', 'Delete block', () => this.deleteBlock(block.id));
            deleteBtn.style.color = 'var(--text-error)';
            deleteBtn.style.display = this.context.blocks.length > 1 ? 'block' : 'none';
            controls.appendChild(deleteBtn);

            header.appendChild(controls);
            blockEl.appendChild(header);
        } else {
            const miniHeader = document.createElement('div');
            miniHeader.style.display = 'flex';
            miniHeader.style.justifyContent = 'flex-start';
            miniHeader.style.marginBottom = '5px';
            miniHeader.style.opacity = '0.5';

            const typeLabel = document.createElement('span');
            typeLabel.textContent = this.getBlockTypeIcon(block.type);
            typeLabel.style.fontSize = '11px';
            typeLabel.style.padding = '2px 6px';
            typeLabel.style.background = 'var(--background-modifier-border)';
            typeLabel.style.borderRadius = '3px';
            miniHeader.appendChild(typeLabel);

            blockEl.appendChild(miniHeader);
        }

        const canvas = document.createElement('canvas');
        canvas.width = block.bbox.width;
        canvas.height = block.bbox.height;
        canvas.style.width = block.bbox.width + 'px';
        canvas.style.height = block.bbox.height + 'px';
        canvas.style.border = isSelected ? '1px solid var(--background-modifier-border)' : 'none';
        canvas.style.borderRadius = '4px';
        canvas.style.background = 'var(--background-primary)';

        const ctx = canvas.getContext('2d');
        if (ctx) {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = block.bbox.width * dpr;
            canvas.height = block.bbox.height * dpr;
            ctx.scale(dpr, dpr);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
        }

        this.context.drawingManager.setupCanvasEvents(canvas, index);
        this.context.drawingManager.drawBlockStrokes(canvas, block);

        blockEl.appendChild(canvas);

        if (isSelected) {
            const addBlockAboveBtn = this.createAddBlockButton('above', index);
            blockEl.insertBefore(addBlockAboveBtn, canvas);

            const addBlockBelowBtn = this.createAddBlockButton('below', index);
            blockEl.appendChild(addBlockBelowBtn);
        }

        blockEl.onclick = (e) => {
            const target = e.target as HTMLElement;
            // Nur auswählen, wenn nicht auf interaktive Elemente geklickt wird
            if (!target.closest('select, button, input, .grid-line, .table-cell-overlay')) {
                this.context.currentBlockIndex = index;
                this.renderBlocks(); // Neu rendern aktualisiert die UI komplett

                // Tabellen-Tools aktualisieren
                setTimeout(() => {
                    if (this.context.toolbarManager) {
                        this.context.toolbarManager.updateTableToolsVisibility();
                    }
                }, 0);
            }
        };

        blockEl.ondblclick = (e) => {
            this.context.currentBlockIndex = index;
            this.renderBlocks();

            // Tabellen-Tools aktualisieren
            setTimeout(() => {
                if (this.context.toolbarManager) {
                    this.context.toolbarManager.updateTableToolsVisibility();
                }
            }, 0);
        };

        return blockEl;
    }

    private getBlockTypeIcon(type: BlockType): string {
        const icons: Record<BlockType, string> = {
            'paragraph': '📝',
            'heading1': 'H1',
            'heading2': 'H2',
            'heading3': 'H3',
            'heading4': 'H4',
            'heading5': 'H5',
            'math': '∑',
            'quote': '❝',
            'drawing': '🖼️',
            'table': '📊'
        };
        return icons[type] || '?';
    }

    private createAddBlockButton(position: 'above' | 'below', blockIndex: number): HTMLElement {
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'center';
        buttonContainer.style.alignItems = 'center';
        buttonContainer.style.margin = position === 'above' ? '0 0 10px 0' : '10px 0 0 0';
        buttonContainer.style.padding = position === 'above' ? '0 0 10px 0' : '10px 0 0 0';
        buttonContainer.style.position = 'relative';

        const line = document.createElement('div');
        line.style.position = 'absolute';
        line.style.top = position === 'above' ? '100%' : '0';
        line.style.left = '20%';
        line.style.right = '20%';
        line.style.height = '1px';
        line.style.background = 'var(--background-modifier-border)';
        line.style.opacity = '0.5';
        buttonContainer.appendChild(line);

        const addButton = document.createElement('button');
        addButton.textContent = position === 'above' ? '＋ Add Block Above' : '＋ Add Block Below';
        addButton.title = position === 'above' ? 'Add new block above this one' : 'Add new block below this one';
        addButton.style.padding = '4px 12px';
        addButton.style.fontSize = '11px';
        addButton.style.border = '1px solid var(--background-modifier-border)';
        addButton.style.borderRadius = '4px';
        addButton.style.background = 'var(--interactive-normal)';
        addButton.style.cursor = 'pointer';
        addButton.style.color = 'var(--text-muted)';
        addButton.style.zIndex = '10';
        addButton.style.position = 'relative';

        addButton.onmouseenter = () => {
            addButton.style.background = 'var(--interactive-hover)';
            addButton.style.color = 'var(--text-normal)';
            line.style.opacity = '1';
        };
        addButton.onmouseleave = () => {
            addButton.style.background = 'var(--interactive-normal)';
            addButton.style.color = 'var(--text-muted)';
            line.style.opacity = '0.5';
        };

        addButton.onclick = (e) => {
            e.stopPropagation();
            const insertPosition = position === 'above' ? blockIndex : blockIndex + 1;
            this.addNewBlockAtPosition('paragraph', insertPosition);
        };

        buttonContainer.appendChild(addButton);
        return buttonContainer;
    }

    private createBlockControlButton(icon: string, title: string, onClick: () => void): HTMLElement {
        const button = document.createElement('button');
        button.innerHTML = icon;
        button.title = title;
        button.style.padding = '2px 6px';
        button.style.fontSize = '12px';
        button.style.border = '1px solid var(--background-modifier-border)';
        button.style.borderRadius = '4px';
        button.style.background = 'var(--background-primary)';
        button.style.cursor = 'pointer';
        button.onclick = (e) => {
            e.stopPropagation();
            onClick();
        };
        return button;
    }

    public addNewBlockAtPosition(type: BlockType, position: number): void {
        const newBlock: Block = {
            id: crypto.randomUUID(),
            type,
            strokeIds: [],
            bbox: {
                x: 20,
                y: position * 250 + 20,
                width: 760,
                height: 200
            },
            order: position
        };

        this.context.blocks.splice(position, 0, newBlock);

        this.context.blocks.forEach((b, idx) => {
            b.order = idx;
        });

        this.context.currentBlockIndex = position;
        this.renderBlocks();

        setTimeout(() => {
            const blockEl = this.context.blocksContainer?.querySelector(`.ink-block[data-block-id="${newBlock.id}"]`);
            if (blockEl) {
                blockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 50);
    }

    public addNewBlock(type: BlockType, order: number, select = false): void {
        const newBlock: Block = {
            id: crypto.randomUUID(),
            type,
            strokeIds: [],
            bbox: {
                x: 20,
                y: order * 250 + 20,
                width: type === 'table' ? 800 : 760, // Breitere Tabellen
                height: type === 'table' ? 300 : 200 // Höhere Tabellen
            },
            order
        };

        // Für Tabellen: Gitter initialisieren
        if (type === 'table') {
            setTimeout(() => {
                this.context.blockManager.initializeTableBlock(newBlock.id, 3, 3);
            }, 100);
        }

        this.context.blocks.push(newBlock);

        this.context.blocks.forEach((block, idx) => {
            block.order = idx;
        });

        if (select) {
            this.context.currentBlockIndex = this.context.blocks.length - 1;
        }

        this.renderBlocks();
    }

    private moveBlockUp(index: number): void {
        if (index <= 0) return;

        const currentBlock = this.context.blocks[index];
        const previousBlock = this.context.blocks[index - 1];

        if (!currentBlock || !previousBlock) return;

        const tempOrder = currentBlock.order;
        currentBlock.order = previousBlock.order;
        previousBlock.order = tempOrder;

        this.context.blocks[index] = previousBlock;
        this.context.blocks[index - 1] = currentBlock;

        this.context.currentBlockIndex = index - 1;
        this.renderBlocks();
    }

    private moveBlockDown(index: number): void {
        if (index >= this.context.blocks.length - 1) return;

        const currentBlock = this.context.blocks[index];
        const nextBlock = this.context.blocks[index + 1];

        if (!currentBlock || !nextBlock) return;

        const tempOrder = currentBlock.order;
        currentBlock.order = nextBlock.order;
        nextBlock.order = tempOrder;

        this.context.blocks[index] = nextBlock;
        this.context.blocks[index + 1] = currentBlock;

        this.context.currentBlockIndex = index + 1;
        this.renderBlocks();
    }

    private clearBlock(blockId: string): void {
        const blockIndex = this.context.blocks.findIndex(b => b.id === blockId);
        if (blockIndex >= 0) {
            const block = this.context.blocks[blockIndex];
            if (block && this.context.document) {
                block.strokeIds.forEach(strokeId => {
                    if (this.context.document) {
                        this.context.document.removeStroke(strokeId);
                    }
                });

                block.strokeIds = [];

                const canvas = this.getCanvasForBlock(blockId);
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        const isDark = this.context.styleManager.isDarkTheme();
                        ctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }
                }

                const isSelected = blockIndex === this.context.currentBlockIndex;
                block.bbox.width = 760;
                block.bbox.height = isSelected ? 200 : 120;

                if (canvas) {
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
                }

                const blockEl = this.context.blocksContainer?.querySelector(`.ink-block[data-block-id="${blockId}"]`) as HTMLElement;
                if (blockEl) {
                    blockEl.style.minHeight = `${block.bbox.height + (isSelected ? 100 : 50)}px`;
                }

                this.renderBlocks();
                new Notice('Block cleared');
            }
        }
    }

    private deleteBlock(blockId: string): void {
        const blockIndex = this.context.blocks.findIndex(b => b.id === blockId);
        if (blockIndex >= 0) {
            const block = this.context.blocks[blockIndex];

            if (block && this.context.document) {
                block.strokeIds.forEach(strokeId => {
                    if (this.context.document) {
                        this.context.document.removeStroke(strokeId);
                    }
                });
            }

            this.context.blocks.splice(blockIndex, 1);

            this.context.blocks.forEach((b, idx) => b.order = idx);

            this.context.currentBlockIndex = Math.min(
                Math.max(0, this.context.currentBlockIndex - 1),
                this.context.blocks.length - 1
            );

            this.renderBlocks();
            new Notice('Block deleted');
        }
    }

    public createTableGridOverlay(blockEl: HTMLElement, block: Block): void {
        if (!block.tableGrid) return;

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

        const overlay = document.createElement('div');
        overlay.className = 'table-grid-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '5';

        const grid = block.tableGrid;
        let currentY = 0;

        // Zeichne horizontale Linien
        for (let i = 0; i < grid.rows; i++) {
            if (i < grid.rows - 1 && grid.visibleLines.horizontal[i]) {
                const lineEl = this.createGridLine('horizontal', i, currentY, grid, block);
                overlay.appendChild(lineEl);
            }

            if (grid.rowHeights[i] !== undefined) {
                currentY += grid.rowHeights[i]!;
            }
        }

        let currentX = 0;
        // Zeichne vertikale Linien
        for (let i = 0; i < grid.cols; i++) {
            if (i < grid.cols - 1 && grid.visibleLines.vertical[i]) {
                const lineEl = this.createGridLine('vertical', i, currentX, grid, block);
                overlay.appendChild(lineEl);
            }

            if (grid.colWidths[i] !== undefined) {
                currentX += grid.colWidths[i]!;
            }
        }

        // Nur Zellen-Hover im Merge-Modus
        const tableMode = this.context.toolbarManager.getCurrentTableMode();
        if (tableMode === 'merge-cells') {
            this.createCellOverlays(overlay, grid, block);
        }

        // Sicherstellen, dass das Block-Element noch existiert
        if (document.body.contains(blockEl)) {
            blockEl.appendChild(overlay);
        }
    }

    private createGridLine(type: 'horizontal' | 'vertical', index: number, position: number, grid: TableGrid, block: Block): HTMLElement {
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
            lineEl.style.height = '3px';
            lineEl.style.backgroundColor = isSelected ? 'var(--text-accent)' : 'var(--interactive-accent)';
            lineEl.style.opacity = isSelected ? '0.9' : '0.6';
            lineEl.style.cursor = 'ns-resize';
            lineEl.style.zIndex = '10';
            lineEl.style.pointerEvents = 'auto';
        } else {
            lineEl.style.position = 'absolute';
            lineEl.style.left = `${position}px`;
            lineEl.style.top = '0';
            lineEl.style.width = '3px';
            lineEl.style.height = '100%';
            lineEl.style.backgroundColor = isSelected ? 'var(--text-accent)' : 'var(--interactive-accent)';
            lineEl.style.opacity = isSelected ? '0.9' : '0.6';
            lineEl.style.cursor = 'ew-resize';
            lineEl.style.zIndex = '10';
            lineEl.style.pointerEvents = 'auto';
        }

        // Event-Listener hinzufügen
        this.setupGridLineEvents(lineEl, type, index, block);

        return lineEl;
    }

    private createCellOverlays(overlay: HTMLElement, grid: TableGrid, block: Block): void {
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

                if (cell) {
                    const cellOverlay = document.createElement('div');
                    cellOverlay.className = 'table-cell-overlay';
                    cellOverlay.style.position = 'absolute';
                    cellOverlay.style.left = `${currentX}px`;
                    cellOverlay.style.top = `${currentY}px`;
                    cellOverlay.style.width = `${colWidth}px`;
                    cellOverlay.style.height = `${rowHeight}px`;
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

        let isDragging = false;
        let dragStartPosition = 0;
        let originalLinePosition = 0;

        // Mousedown-Event für Drag-Beginn
        lineEl.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();

            isDragging = true;
            dragStartPosition = type === 'horizontal' ? e.clientY : e.clientX;

            // Aktuelle Position der Linie speichern
            if (type === 'horizontal') {
                originalLinePosition = lineEl.offsetTop;
            } else {
                originalLinePosition = lineEl.offsetLeft;
            }

            // CSS-Klassen für visuelles Feedback
            lineEl.classList.add('dragging');

            // Globalen Event-Listener für Mousemove und Mouseup hinzufügen
            const handleMouseMove = (moveEvent: MouseEvent) => {
                if (!isDragging) return;

                const currentPosition = type === 'horizontal' ? moveEvent.clientY : moveEvent.clientX;
                const delta = currentPosition - dragStartPosition;
                const newPosition = originalLinePosition + delta;

                // Linie visuell verschieben
                if (type === 'horizontal') {
                    lineEl.style.top = `${newPosition}px`;
                } else {
                    lineEl.style.left = `${newPosition}px`;
                }

                // Verhindere Seiteneffekte
                moveEvent.stopPropagation();
            };

            const handleMouseUp = (upEvent: MouseEvent) => {
                if (!isDragging) return;

                isDragging = false;
                lineEl.classList.remove('dragging');

                const currentPosition = type === 'horizontal' ? upEvent.clientY : upEvent.clientX;
                const delta = currentPosition - dragStartPosition;
                const finalPosition = originalLinePosition + delta;

                // Grid-Daten aktualisieren
                this.updateGridAfterLineMove(block.id, type, index, finalPosition);

                // Event-Listener entfernen
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);

                upEvent.stopPropagation();
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });

        // Verhindere Doppelklick-Fehler
        lineEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            e.preventDefault();

            this.removeGridLine(block.id, type, index);
        });
    }

    private removeGridLine(blockId: string, type: 'horizontal' | 'vertical', index: number): void {
        const block = this.context.blocks.find(b => b.id === blockId);
        if (!block || !block.tableGrid) return;

        const grid = block.tableGrid;

        if (type === 'horizontal') {
            // Entferne horizontale Linie
            if (index >= 0 && index < grid.visibleLines.horizontal.length) {
                // Markiere Linie als unsichtbar
                grid.visibleLines.horizontal[index] = false;

                // Wenn es die letzte sichtbare Linie ist, passe Block-Größe an
                this.adjustBlockSizeAfterGridChange(block);
            }
        } else {
            // Entferne vertikale Linie
            if (index >= 0 && index < grid.visibleLines.vertical.length) {
                // Markiere Linie als unsichtbar
                grid.visibleLines.vertical[index] = false;

                // Wenn es die letzte sichtbare Linie ist, passe Block-Größe an
                this.adjustBlockSizeAfterGridChange(block);
            }
        }

        this.renderBlocks();
        new Notice(`Line removed (${type})`);
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
            }
        }

        // Block-Größe anpassen
        this.adjustBlockSizeAfterGridChange(block);

        // Neu rendern (aber ohne das Overlay neu zu erstellen, während es noch existiert)
        setTimeout(() => {
            this.renderBlocks();
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
        const canvas = this.getCanvasForBlock(block.id);
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

        this.renderBlocks();
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

                // Sichtbare Linien anpassen
                grid.visibleLines.horizontal.splice(rowIndex, 0, true);

                // Zellen anpassen
                this.adjustCellsForNewRow(grid, rowIndex);

                this.renderBlocks();
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

                grid.visibleLines.vertical.splice(colIndex, 0, true);

                this.adjustCellsForNewColumn(grid, colIndex);

                this.renderBlocks();
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
        if (!tableMode || !block.tableGrid) return false;

        // Prüfe ob Klick auf einer existierenden Linie
        const grid = block.tableGrid;
        let isOnLine = false;

        // Prüfe horizontale Linien
        let currentY = 0;
        for (let i = 0; i <= grid.rows; i++) {
            if (i < grid.rows && grid.visibleLines.horizontal[i]) {
                const lineY = currentY;
                if (Math.abs(y - lineY) < 10) { // Toleranzbereich
                    isOnLine = true;
                    break;
                }
            }
            if (grid.rowHeights[i] !== undefined && i < grid.rows) {
                currentY += grid.rowHeights[i]!;
            }
        }

        // Prüfe vertikale Linien
        let currentX = 0;
        for (let i = 0; i <= grid.cols; i++) {
            if (i < grid.cols && grid.visibleLines.vertical[i]) {
                const lineX = currentX;
                if (Math.abs(x - lineX) < 10) { // Toleranzbereich
                    isOnLine = true;
                    break;
                }
            }
            if (grid.colWidths[i] !== undefined && i < grid.cols) {
                currentX += grid.colWidths[i]!;
            }
        }

        // Wenn auf Linie, dann nicht neue Linie einfügen
        if (isOnLine) {
            return false;
        }

        // Finde die Zelle, in der geklickt wurde
        let cellX = 0, cellY = 0;
        let foundCol = -1, foundRow = -1;

        currentY = 0;
        for (let r = 0; r < grid.rows; r++) {
            const rowHeight = grid.rowHeights[r];
            if (rowHeight === undefined) continue;

            if (y >= currentY && y <= currentY + rowHeight) {
                foundRow = r;
                cellY = currentY;
                break;
            }
            currentY += rowHeight;
        }

        currentX = 0;
        for (let c = 0; c < grid.cols; c++) {
            const colWidth = grid.colWidths[c];
            if (colWidth === undefined) continue;

            if (x >= currentX && x <= currentX + colWidth) {
                foundCol = c;
                cellX = currentX;
                break;
            }
            currentX += colWidth;
        }

        if (foundRow >= 0 && foundCol >= 0) {
            if (tableMode === 'vertical-line') {
                // Bestimme ob links oder rechts basierend auf Klickposition
                const colWidth = grid.colWidths[foundCol];
                if (colWidth === undefined) return false;

                const relativeX = (x - cellX) / colWidth;
                const insertIndex = relativeX < 0.5 ? foundCol : foundCol + 1;

                this.insertTableColumn(block.id, insertIndex);
                return true;
            } else if (tableMode === 'horizontal-line') {
                // Bestimme ob oben oder unten basierend auf Klickposition
                const rowHeight = grid.rowHeights[foundRow];
                if (rowHeight === undefined) return false;

                const relativeY = (y - cellY) / rowHeight;
                const insertIndex = relativeY < 0.5 ? foundRow : foundRow + 1;

                this.insertTableRow(block.id, insertIndex);
                return true;
            }
        }

        return false;
    }

    private toggleLineVisibility(blockId: string, type: 'horizontal' | 'vertical', index: number): void {
        const block = this.context.blocks.find(b => b.id === blockId);
        if (!block || !block.tableGrid) return;

        const grid = block.tableGrid;

        if (type === 'horizontal' && index < grid.visibleLines.horizontal.length) {
            grid.visibleLines.horizontal[index] = !grid.visibleLines.horizontal[index];
        } else if (type === 'vertical' && index < grid.visibleLines.vertical.length) {
            grid.visibleLines.vertical[index] = !grid.visibleLines.vertical[index];
        }

        this.renderBlocks();
        new Notice(`Line ${type === 'horizontal' ? 'horizontal' : 'vertical'} ${grid.visibleLines[type === 'horizontal' ? 'horizontal' : 'vertical'][index] ? 'shown' : 'hidden'}`);
    }

    public removeSelectedLine(): void {
        if (!this.selectedLine) return;

        const currentBlock = this.context.blocks[this.context.currentBlockIndex];
        if (!currentBlock || currentBlock.type !== 'table') return;

        this.toggleLineVisibility(currentBlock.id, this.selectedLine.type, this.selectedLine.index);
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
            cells,
            visibleLines: {
                horizontal: Array(rows - 1).fill(true),
                vertical: Array(cols - 1).fill(true)
            }
        };

        // Block-Größe setzen
        const totalHeight = rowHeights.reduce((a, b) => a + b, 0) + 40;
        const totalWidth = colWidths.reduce((a, b) => a + b, 0) + 40;

        block.bbox.width = Math.max(block.bbox.width, totalWidth);
        block.bbox.height = Math.max(block.bbox.height, totalHeight);

        this.renderBlocks();
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

        // Sichtbare Linien anpassen
        grid.visibleLines.horizontal.splice(rowIndex, 0, true);

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

        this.renderBlocks();
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

        // Sichtbare Linien anpassen
        grid.visibleLines.vertical.splice(colIndex, 0, true);

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

        this.renderBlocks();
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

        // Linien innerhalb des Merge-Bereichs ausblenden
        for (let r = startRow; r < endRow; r++) {
            if (grid.visibleLines.horizontal[r]) {
                grid.visibleLines.horizontal[r] = false;
            }
        }

        for (let c = startCol; c < endCol; c++) {
            if (grid.visibleLines.vertical[c]) {
                grid.visibleLines.vertical[c] = false;
            }
        }

        this.renderBlocks();
    }

    public setTableToolMode(mode: 'add-line' | 'move-line' | 'merge-cells' | null): void {
        this.tableToolMode = mode;
        this.mergeStartCell = null;
        this.selectedLine = null;
        this.renderBlocks();
    }

    public getTableToolMode(): 'add-line' | 'move-line' | 'merge-cells' | null {
        return this.tableToolMode;
    }

    public getCanvasForBlock(blockId: string): HTMLCanvasElement | null {
        if (!this.context.blocksContainer) return null;
        const blockEl = this.context.blocksContainer.querySelector(`.ink-block[data-block-id="${blockId}"]`);
        if (!blockEl) return null;
        return blockEl.querySelector('canvas') as HTMLCanvasElement;
    }

    public updateBlockMargins(): void {
        if (!this.context.blocksContainer) return;

        const blocks = this.context.blocksContainer.querySelectorAll('.ink-block');
        blocks.forEach((block: HTMLElement, index) => {
            const isSelected = index === this.context.currentBlockIndex;
            const marginTop = isSelected ?
                Math.max(this.context.blockManager.blockMargins.top, 12) :
                this.context.blockManager.blockMargins.top;
            const marginBottom = isSelected ?
                Math.max(this.context.blockManager.blockMargins.bottom, 12) :
                this.context.blockManager.blockMargins.bottom;

            block.style.marginTop = `${marginTop}px`;
            block.style.marginBottom = `${marginBottom}px`;
        });
    }

    public getSelectedLine(): { type: 'horizontal' | 'vertical', index: number } | null {
        return this.selectedLine;
    }

    public get blockMargins() {
        return this.context.toolbarManager.blockMargins;
    }
}