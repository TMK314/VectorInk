import { Block, BlockType, PartialBlock, BoundingBox } from '../types';
import { InkView } from './InkView';
import { Notice, Platform } from 'obsidian';

export class BlockManager {
    private context: InkView;

    /**
     * Alle ausgewaehlten Block-Indizes.
     * context.currentBlockIndex = primaerer Block (Toolbar-Sync).
     * Ctrl/Cmd+Klick: Toggle. Shift+Klick: Bereich.
     */
    public selectedBlockIndices: Set<number> = new Set([0]);

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
        });
    }

    private createBlockElement(block: Block, index: number): HTMLElement {
        const isPrimary = index === this.context.currentBlockIndex;
        const isInSelection = this.selectedBlockIndices.has(index);
        const isSelected = isPrimary || isInSelection;

        const blockEl = document.createElement('div');
        blockEl.className = 'ink-block';
        blockEl.dataset.blockId = block.id;
        blockEl.dataset.blockType = block.type;
        blockEl.setCssStyles({
            position: 'relative',
            width: `${block.bbox.width + 24}px`,
            marginTop: '10px',
            marginBottom: '10px',
            borderRadius: '6px',
            background: 'var(--background-primary)',
            padding: '12px',
            transition: 'all 0.2s ease',
            userSelect: 'none',
            cursor: 'default'
        });

        // Rahmen: primaer = durchgezogen, Mehrfachauswahl = gestrichelt, Rest = dezent
        if (isPrimary) {
            blockEl.setCssStyles({
                border: '2px solid var(--interactive-accent)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            });
        } else if (isInSelection) {
            blockEl.setCssStyles({
                border: '1.5px dashed var(--interactive-accent)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
            });
        } else {
            blockEl.setCssStyles({
                border: '1px solid var(--background-modifier-border)',
                boxShadow: 'none'
            });
        }

        if (isSelected) {
            const header = document.createElement('div');
            header.setCssStyles({
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px',
                paddingBottom: '5px',
                borderBottom: '1px solid var(--background-modifier-border)',
                minHeight: '32px'
            });

            const typeSelector = document.createElement('select');
            typeSelector.setCssStyles({
                marginRight: '10px',
                fontSize: '12px',
                padding: '2px 4px',
                width: '130px',
                flexShrink: '0'
            });

            const blockTypes: { value: BlockType, label: string, icon: string }[] = [
                { value: 'paragraph', label: 'Paragraph', icon: '📝' },
                { value: 'heading1', label: 'Heading 1', icon: 'H1' },
                { value: 'heading2', label: 'Heading 2', icon: 'H2' },
                { value: 'heading3', label: 'Heading 3', icon: 'H3' },
                { value: 'heading4', label: 'Heading 4', icon: 'H4' },
                { value: 'heading5', label: 'Heading 5', icon: 'H5' },
                { value: 'math', label: 'Math', icon: '∑' },
                { value: 'quote', label: 'Quote', icon: '❝' },
                { value: 'drawing', label: 'Drawing', icon: '🖼️' }
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
            controls.setCssStyles({
                display: 'flex',
                gap: '5px',
                flexShrink: '0'
            });

            const upBtn = this.createBlockControlButton('↑', 'Move up', () => this.moveBlockUp(index));
            upBtn.style.display = index === 0 ? 'none' : 'block';
            controls.appendChild(upBtn);

            const downBtn = this.createBlockControlButton('↓', 'Move down', () => this.moveBlockDown(index));
            downBtn.style.display = index === this.context.blocks.length - 1 ? 'none' : 'block';
            controls.appendChild(downBtn);

            const separator = document.createElement('span');
            separator.setCssStyles({
                margin: '0 5px',
                color: 'var(--background-modifier-border)'
            });
            separator.textContent = '|';
            controls.appendChild(separator);

            const clearBtn = this.createBlockControlButton('🗑️', 'Clear block', () => this.clearBlock(block.id));
            controls.appendChild(clearBtn);

            const deleteBtn = this.createBlockControlButton('✕', 'Delete block', () => this.deleteBlock(block.id));
            deleteBtn.setCssStyles({ color: 'var(--text-error)' });
            deleteBtn.style.display = this.context.blocks.length > 1 ? 'block' : 'none';
            controls.appendChild(deleteBtn);

            header.appendChild(controls);
            blockEl.appendChild(header);
        } else {
            const miniHeader = document.createElement('div');
            miniHeader.setCssStyles({
                display: 'flex',
                justifyContent: 'flex-start',
                marginBottom: '5px',
                opacity: '0.5'
            });

            const typeLabel = document.createElement('span');
            typeLabel.textContent = this.getBlockTypeIcon(block.type);
            typeLabel.setCssStyles({
                fontSize: '11px',
                padding: '2px 6px',
                background: 'var(--background-modifier-border)',
                borderRadius: '3px'
            });
            miniHeader.appendChild(typeLabel);

            blockEl.appendChild(miniHeader);
        }

        const canvas = document.createElement('canvas');
        canvas.width = block.bbox.width;
        canvas.height = block.bbox.height;
        canvas.setCssStyles({
            width: block.bbox.width + 'px',
            height: block.bbox.height + 'px',
            border: isSelected ? '1px solid var(--background-modifier-border)' : 'none',
            borderRadius: '4px',
            background: 'var(--background-primary)'
        });

        const ctx = canvas.getContext('2d');
        if (ctx) {
            const dpr = window.devicePixelRatio || 1;
            const viewScale = this.context.viewScale || 1;
            const effectiveDpr = dpr * viewScale;
            canvas.width = block.bbox.width * effectiveDpr;
            canvas.height = block.bbox.height * effectiveDpr;
            ctx.scale(effectiveDpr, effectiveDpr);
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
            if (!target.closest('select, button, input, .grid-line, .table-cell-overlay')) {
                const isMac = Platform.isMacOS;
                const isMultiSelectKey = isMac ? e.metaKey : e.ctrlKey;
                const isRangeSelectKey = e.shiftKey;

                const prevPrimary = this.context.currentBlockIndex;

                if (isMultiSelectKey) {
                    if (this.selectedBlockIndices.has(index)) {
                        this.selectedBlockIndices.delete(index);
                        if (this.selectedBlockIndices.size === 0) {
                            this.selectedBlockIndices.add(index);
                            this.context.currentBlockIndex = index;
                        } else {
                            this.context.currentBlockIndex = Math.min(...Array.from(this.selectedBlockIndices));
                        }
                    } else {
                        this.selectedBlockIndices.add(index);
                        this.context.currentBlockIndex = Math.min(...Array.from(this.selectedBlockIndices));
                    }
                } else if (isRangeSelectKey) {
                    const start = Math.min(this.context.currentBlockIndex, index);
                    const end = Math.max(this.context.currentBlockIndex, index);
                    this.selectedBlockIndices.clear();
                    for (let i = start; i <= end; i++) this.selectedBlockIndices.add(i);
                    this.context.currentBlockIndex = start;
                } else {
                    this.selectedBlockIndices.clear();
                    this.selectedBlockIndices.add(index);
                    this.context.currentBlockIndex = index;
                }

                // Vollständiges Re-Render wenn sich der primäre Block ändert
                // (Header/Buttons werden in createBlockElement erzeugt und müssen neu gebaut werden)
                if (this.context.currentBlockIndex !== prevPrimary) {
                    this.renderBlocks();
                } else {
                    this._updateBlockSelectionStyles();
                }
                this.context.toolbarManager?.syncToolbarToCurrentBlock();
            }
        };

        blockEl.ondblclick = (e) => {
            const prevPrimary = this.context.currentBlockIndex;
            this.selectedBlockIndices.clear();
            this.selectedBlockIndices.add(index);
            this.context.currentBlockIndex = index;
            if (this.context.currentBlockIndex !== prevPrimary) {
                this.renderBlocks();
            } else {
                this._updateBlockSelectionStyles();
            }
            this.context.toolbarManager?.syncToolbarToCurrentBlock();
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
            'drawing': '🖼️'
        };
        return icons[type] || '?';
    }

    private createAddBlockButton(position: 'above' | 'below', blockIndex: number): HTMLElement {
        const buttonContainer = document.createElement('div');
        buttonContainer.setCssStyles({
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            margin: position === 'above' ? '0 0 10px 0' : '10px 0 0 0',
            padding: position === 'above' ? '0 0 10px 0' : '10px 0 0 0',
            position: 'relative'
        });

        const line = document.createElement('div');
        line.setCssStyles({
            position: 'absolute',
            top: position === 'above' ? '100%' : '0',
            left: '20%',
            right: '20%',
            height: '1px',
            background: 'var(--background-modifier-border)',
            opacity: '0.5'
        });
        buttonContainer.appendChild(line);

        const addButton = document.createElement('button');
        addButton.textContent = position === 'above' ? '＋ Add Block Above' : '＋ Add Block Below';
        addButton.title = position === 'above' ? 'Add new block above this one' : 'Add new block below this one';
        addButton.setCssStyles({
            padding: '4px 12px',
            fontSize: '11px',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '4px',
            background: 'var(--interactive-normal)',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            zIndex: '10',
            position: 'relative'
        });

        addButton.onmouseenter = () => {
            addButton.setCssStyles({
                background: 'var(--interactive-hover)',
                color: 'var(--text-normal)'
            });
            line.setCssStyles({ opacity: '1' });
        };
        addButton.onmouseleave = () => {
            addButton.setCssStyles({
                background: 'var(--interactive-normal)',
                color: 'var(--text-muted)'
            });
            line.setCssStyles({ opacity: '0.5' });
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
        button.textContent = icon;
        button.title = title;
        button.setCssStyles({
            padding: '2px 6px',
            fontSize: '12px',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '4px',
            background: 'var(--background-primary)',
            cursor: 'pointer'
        });
        button.onclick = (e) => {
            e.stopPropagation();
            onClick();
        };
        return button;
    }

    public addNewBlockAtPosition(type: BlockType, position: number): void {
        const tm = this.context.toolbarManager;
        const dm = this.context.drawingManager;
        const docGrid = this.context.document?.gridSettings ?? {
            enabled: false, type: 'grid' as const,
            size: 20, color: '#e0e0e0', opacity: 0.5, lineWidth: 0.5,
        };

        const newBlock: Block = {
            id: crypto.randomUUID(),
            type,
            strokeIds: [],
            bbox: { x: 20, y: position * 250 + 20, width: 760, height: 200 },
            order: position,
            displaySettings: {
                grid:            { ...docGrid },
                useColor:        tm?.useColorForStyling ?? false,
                widthMultiplier: dm?.widthMultiplier ?? 1.0,
                backgroundColor: '#ffffff',
                showSeparator:   type.startsWith('heading'),
                showQuoteBar:    type === 'quote',
            },
        };

        this.context.blocks.splice(position, 0, newBlock);

        this.context.blocks.forEach((b, idx) => {
            b.order = idx;
        });

        this.selectedBlockIndices.clear();
        this.selectedBlockIndices.add(position);
        this.context.currentBlockIndex = position;
        this.renderBlocks();
        this.context.toolbarManager?.syncToolbarToCurrentBlock();
        setTimeout(() => {
            const blockEl = this.context.blocksContainer?.querySelector(`.ink-block[data-block-id="${newBlock.id}"]`);
            if (blockEl) {
                blockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 50);
    }

    public addNewBlock(type: BlockType, order: number, select = false): void {
        const tm = this.context.toolbarManager;
        const dm = this.context.drawingManager;
        const docGrid = this.context.document?.gridSettings ?? {
            enabled: false, type: 'grid' as const,
            size: 20, color: '#e0e0e0', opacity: 0.5, lineWidth: 0.5,
        };

        const newBlock: Block = {
            id: crypto.randomUUID(),
            type,
            strokeIds: [],
            bbox: { x: 20, y: order * 250 + 20, width: 760, height: 200 },
            order,
            displaySettings: {
                grid:            { ...docGrid },
                useColor:        tm?.useColorForStyling ?? true,
                widthMultiplier: dm?.widthMultiplier ?? 1.0,
                backgroundColor: '#ffffff',
                showSeparator:   type.startsWith('heading'),
                showQuoteBar:    type === 'quote',
            },
        };

        this.context.blocks.push(newBlock);

        this.context.blocks.forEach((block, idx) => {
            block.order = idx;
        });

        if (select) {
            const newIndex = this.context.blocks.length - 1;
            this.selectedBlockIndices.clear();
            this.selectedBlockIndices.add(newIndex);
            this.context.currentBlockIndex = newIndex;
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

        this.selectedBlockIndices.clear();
        this.selectedBlockIndices.add(index - 1);
        this.context.currentBlockIndex = index - 1;
        this.renderBlocks();
        this.context.toolbarManager?.syncToolbarToCurrentBlock();
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

        this.selectedBlockIndices.clear();
        this.selectedBlockIndices.add(index + 1);
        this.context.currentBlockIndex = index + 1;
        this.renderBlocks();
        this.context.toolbarManager?.syncToolbarToCurrentBlock();
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

                    canvas.setCssStyles({
                        width: `${block.bbox.width}px`,
                        height: `${block.bbox.height}px`
                    });
                }

                const blockEl = this.context.blocksContainer?.querySelector(`.ink-block[data-block-id="${blockId}"]`) as HTMLElement;
                if (blockEl) {
                    blockEl.setCssStyles({ minHeight: `${block.bbox.height + (isSelected ? 100 : 50)}px` });
                }

                this.renderBlocks();
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
        }
    }

    public getCanvasForBlock(blockId: string): HTMLCanvasElement | null {
        if (!this.context.blocksContainer) return null;
        const blockEl = this.context.blocksContainer.querySelector(`.ink-block[data-block-id="${blockId}"]`);
        if (!blockEl) return null;
        return blockEl.querySelector('canvas') as HTMLCanvasElement;
    }

    public updateBlockMargins(): void {
        if (!this.context.blocksContainer) return;
        const blocks = this.context.blocksContainer.querySelectorAll<HTMLElement>('.ink-block');
        blocks.forEach(() => { /* Abstände werden in createBlockElement gesetzt */ });
    }

    /**
 * Aktualisiert nur die visuellen Selektions-Stile der bestehenden Block-Elemente,
 * ohne den DOM neu aufzubauen oder Canvases neu zu rendern.
 */
    private _updateBlockSelectionStyles(): void {
        if (!this.context.blocksContainer) return;

        this.context.blocks.forEach((block, index) => {
            const blockEl = this.context.blocksContainer!
                .querySelector<HTMLElement>(`.ink-block[data-block-id="${block.id}"]`);
            if (!blockEl) return;

            const isPrimary = index === this.context.currentBlockIndex;
            const isInSelection = this.selectedBlockIndices.has(index);

            if (isPrimary) {
                blockEl.setCssStyles({
                    border: '2px solid var(--interactive-accent)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                });
            } else if (isInSelection) {
                blockEl.setCssStyles({
                    border: '1.5px dashed var(--interactive-accent)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
                });
            } else {
                blockEl.setCssStyles({
                    border: '1px solid var(--background-modifier-border)',
                    boxShadow: 'none'
                });
            }
        });
    }
}