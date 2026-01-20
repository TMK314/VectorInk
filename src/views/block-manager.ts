import { table } from 'console';
import { Block, BlockType, PartialBlock, BoundingBox, TableLine } from '../types';
import { InkView } from './InkView';
import { Notice } from 'obsidian';

export class BlockManager {
    private context: InkView;
    private selectedLineId: string | null = null;
    private isMovingLine = false;
    private movingLineType: 'horizontal' | 'vertical' | null = null;
    private dragStartPosition = 0;
    private dragStartLinePosition = 0;

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
            
            // Tabellenlinien als Overlay hinzufügen
            if (block.type === 'table' && block.tableLines) {
                this.createTableLinesOverlay(blockElement, block);
            }
        });
    }

    private createBlockElement(block: Block, index: number): HTMLElement {
        const isSelected = index === this.context.currentBlockIndex;

        const blockEl = document.createElement('div');
        blockEl.className = 'ink-block';
        blockEl.dataset.blockId = block.id;
        blockEl.dataset.selected = isSelected.toString();
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
            if (!target.closest('select, button, input')) {
                this.context.currentBlockIndex = index;
                this.renderBlocks();
            }
        };

        blockEl.ondblclick = (e) => {
            this.context.currentBlockIndex = index;
            this.renderBlocks();
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
                width: 760,
                height: 200
            },
            order
        };

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

    public createTableLinesOverlay(blockEl: HTMLElement, block: Block): void {
        // Entferne vorhandene Overlays
        const existingOverlay = blockEl.querySelector('.table-lines-overlay');
        if (existingOverlay) existingOverlay.remove();

        const overlay = document.createElement('div');
        overlay.className = 'table-lines-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.pointerEvents = 'none'; // Ermöglicht Klicks durch das Overlay
        overlay.style.zIndex = '10';

        if (block.tableLines) {
            block.tableLines.forEach(line => {
                if (line.visible) {
                    const lineEl = this.createTableLineElement(line, block);
                    overlay.appendChild(lineEl);
                }
            });
        }

        blockEl.appendChild(overlay);
    }

    private createTableLineElement(line: TableLine, block: Block): HTMLElement {
        const lineEl = document.createElement('div');
        lineEl.className = `table-line ${line.type}-line ${line.id === this.selectedLineId ? 'selected' : ''}`;
        lineEl.dataset.lineId = line.id;
        
        if (line.type === 'horizontal') {
            lineEl.style.position = 'absolute';
            lineEl.style.top = `${line.position}px`;
            lineEl.style.left = '0';
            lineEl.style.width = '100%';
            lineEl.style.height = '2px';
            lineEl.style.borderTop = '2px dashed var(--interactive-accent)';
            lineEl.style.cursor = 'ns-resize';
        } else {
            lineEl.style.position = 'absolute';
            lineEl.style.left = `${line.position}px`;
            lineEl.style.top = '0';
            lineEl.style.width = '2px';
            lineEl.style.height = '100%';
            lineEl.style.borderLeft = '2px dashed var(--interactive-accent)';
            lineEl.style.cursor = 'ew-resize';
        }

        // Zeige die Linie nur im Auswahlmodus
        lineEl.style.pointerEvents = 'auto';
        lineEl.style.opacity = this.context.drawingManager.currentTool === 'selection' ? '1' : '0.3';

        // Event Listener für Interaktion
        this.setupTableLineEvents(lineEl, line, block);

        return lineEl;
    }

    private setupTableLineEvents(lineEl: HTMLElement, line: TableLine, block: Block): void {
        lineEl.addEventListener('mousedown', (e) => {
            if (this.context.drawingManager.currentTool !== 'selection') return;
            
            e.stopPropagation();
            e.preventDefault();
            
            this.selectedLineId = line.id;
            this.isMovingLine = true;
            this.movingLineType = line.type;
            
            // Startpositionen speichern
            const canvas = lineEl.closest('.ink-block')?.querySelector('canvas');
            if (!canvas) return;
            
            const canvasRect = canvas.getBoundingClientRect();
            this.dragStartPosition = line.type === 'horizontal' ? e.clientY : e.clientX;
            this.dragStartLinePosition = line.position;
            
            // Selektionsvisualisierung aktualisieren
            this.updateLineSelection(block);
            
            // Mausbewegung und -loslassen Event Listener hinzufügen
            const handleMouseMove = (moveEvent: MouseEvent) => {
                if (!this.isMovingLine || !this.selectedLineId) return;
                
                const blockIndex = this.context.blocks.findIndex(b => b.id === block.id);
                if (blockIndex === -1) return;
                
                const tableBlock = this.context.blocks[blockIndex];
                if (!tableBlock || !tableBlock.tableLines) return;
                
                const lineIndex = tableBlock.tableLines.findIndex(l => l.id === this.selectedLineId);
                if (lineIndex === -1) return;
                
                // Neue Position berechnen
                const delta = (line.type === 'horizontal' ? moveEvent.clientY : moveEvent.clientX) - this.dragStartPosition;
                let newPosition = this.dragStartLinePosition + delta;
                
                // Position begrenzen (mit Padding von 10px zu den Rändern)
                const minPos = 10;
                const maxPos = line.type === 'horizontal' ? canvasRect.height - 10 : canvasRect.width - 10;
                newPosition = Math.max(minPos, Math.min(newPosition, maxPos));
                
                if (typeof tableBlock.tableLines[lineIndex] === 'undefined') return;
                // Position aktualisieren
                tableBlock.tableLines[lineIndex].position = newPosition;
                
                // Linie visuell aktualisieren
                if (line.type === 'horizontal') {
                    lineEl.style.top = `${newPosition}px`;
                } else {
                    lineEl.style.left = `${newPosition}px`;
                }
            };
            
            const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                this.isMovingLine = false;
            };
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });

        // Doppelklick zum Umschalten der Sichtbarkeit
        lineEl.addEventListener('dblclick', (e) => {
            if (this.context.drawingManager.currentTool !== 'selection') return;
            
            e.stopPropagation();
            const blockIndex = this.context.blocks.findIndex(b => b.id === block.id);
            if (blockIndex === -1) return;

            const tableBlock = this.context.blocks[blockIndex];
            if (!tableBlock || !tableBlock.tableLines) return;

            const lineIndex = tableBlock.tableLines.findIndex(l => l.id === line.id);
            if (lineIndex === -1) return;

            if (typeof tableBlock.tableLines[lineIndex] === 'undefined') return;
            tableBlock.tableLines[lineIndex].visible = !tableBlock.tableLines[lineIndex].visible;
            
            // Linie aktualisieren
            lineEl.style.display = tableBlock.tableLines[lineIndex].visible ? 'block' : 'none';
        });
    }

    private updateLineSelection(block: Block): void {
        const blockEl = this.context.blocksContainer?.querySelector(`.ink-block[data-block-id="${block.id}"]`);
        if (!blockEl) return;
        
        // Alle Linien desaktuieren
        const allLines = blockEl.querySelectorAll('.table-line');
        allLines.forEach((lineEl) => {
            lineEl.classList.remove('selected');
        });
        
        // Ausgewählte Linie aktivieren
        if (this.selectedLineId) {
            const selectedLine = blockEl.querySelector(`.table-line[data-line-id="${this.selectedLineId}"]`);
            if (selectedLine) {
                selectedLine.classList.add('selected');
            }
        }
    }


    public addTableLine(blockId: string, type: 'horizontal' | 'vertical'): void {
        const blockIndex = this.context.blocks.findIndex(b => b.id === blockId);
        if (blockIndex === -1) return;

        const block = this.context.blocks[blockIndex];
        if (typeof block === 'undefined') return;
        if (block.type !== 'table') return;

        if (!block.tableLines) {
            block.tableLines = [];
        }

        const newLine: TableLine = {
            id: crypto.randomUUID(),
            type,
            position: type === 'horizontal' ? block.bbox.height / 2 : block.bbox.width / 2,
            visible: true
        };

        block.tableLines.push(newLine);
        
        // Block neu rendern
        this.renderBlocks();
    }

    public removeTableLine(blockId: string, lineId: string): void {
        const blockIndex = this.context.blocks.findIndex(b => b.id === blockId);
        if (blockIndex === -1) return;

        const block = this.context.blocks[blockIndex];
        if (typeof block === 'undefined') return;
        if (!block.tableLines) return;

        const lineIndex = block.tableLines.findIndex(l => l.id === lineId);
        if (lineIndex === -1) return;

        block.tableLines.splice(lineIndex, 1);
        
        // Wenn selectedLineId entfernt wurde, zurücksetzen
        if (this.selectedLineId === lineId) {
            this.selectedLineId = null;
        }
        
        // Block neu rendern (ohne die Linie)
        this.renderBlocks();
        
        // Verhindere übermäßige Verkleinerung bei Tabellen
        if (block.type === 'table') {
            setTimeout(() => {
                this.adjustTableBlockSize(blockId);
            }, 100);
        }
    }

    private adjustTableBlockSize(blockId: string): void {
        const blockIndex = this.context.blocks.findIndex(b => b.id === blockId);
        if (blockIndex === -1) return;

        const block = this.context.blocks[blockIndex];
        const canvas = this.getCanvasForBlock(blockId);

        if (!block || !canvas) return;

        // Mindestgröße für Tabellen festlegen
        const MIN_TABLE_WIDTH = 600;
        const MIN_TABLE_HEIGHT = 300;
        
        // Prüfe, ob Verkleinerung nötig ist
        const shouldShrinkWidth = block.bbox.width > MIN_TABLE_WIDTH * 1.5;
        const shouldShrinkHeight = block.bbox.height > MIN_TABLE_HEIGHT * 1.5;
        
        // Nur moderate Verkleinerung zulassen
        if (shouldShrinkWidth || shouldShrinkHeight) {
            const newWidth = shouldShrinkWidth ? Math.max(MIN_TABLE_WIDTH, block.bbox.width * 0.9) : block.bbox.width;
            const newHeight = shouldShrinkHeight ? Math.max(MIN_TABLE_HEIGHT, block.bbox.height * 0.9) : block.bbox.height;
            
            // Nur ändern, wenn Unterschied signifikant ist (> 20px)
            if (Math.abs(block.bbox.width - newWidth) > 20 || Math.abs(block.bbox.height - newHeight) > 20) {
                block.bbox.width = newWidth;
                block.bbox.height = newHeight;
                
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
                
                this.context.drawingManager.drawBlockStrokes(canvas, block);
                
                // Block-Element-Höhe anpassen
                const blockEl = canvas.closest('.ink-block') as HTMLElement;
                if (blockEl) {
                    const isSelected = blockIndex === this.context.currentBlockIndex;
                    const extraHeight = isSelected ? 120 : 80;
                    blockEl.style.minHeight = `${block.bbox.height + extraHeight}px`;
                }
                
                // Tabellenlinien neu positionieren
                this.createTableLinesOverlay(blockEl, block);
            }
        }
    }

    public clearSelectedLine(): void {
        this.selectedLineId = null;
        this.isMovingLine = false;
        this.movingLineType = null;
        this.renderBlocks();
    }

    public getSelectedLineId(): string | null {
        return this.selectedLineId;
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

    public get blockMargins() {
        return this.context.toolbarManager.blockMargins;
    }
}