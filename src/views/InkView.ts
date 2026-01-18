import { FileView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import VectorInkPlugin from '../main';
import { InkDocument } from '../model/InkDocument';
import { Point, Stroke, StrokeStyle, Block, BlockType, BoundingBox, PartialBlock } from '../types';

export const INK_VIEW_TYPE = 'ink-view';

export class InkView extends FileView {
    plugin: VectorInkPlugin;
    document: InkDocument | null = null;

    // Drawing state
    private isDrawing = false;
    private isErasing = false;
    private currentStroke: Point[] = [];
    private currentTool: 'pen' | 'eraser' | 'selection' = 'pen';
    private eraserMode: 'stroke' | 'point' = 'stroke';
    private currentPenStyle: StrokeStyle = {
        width: 2.0,
        color: '#000000',
        semantic: 'normal',
        opacity: 1.0
    };

    // Block management
    private blocksContainer: HTMLElement | null = null;
    private currentBlockIndex = 0;
    private blocks: Block[] = [];
    private blockMargins: { top: number; bottom: number } = { top: 8, bottom: 8 };

    // Toolbar elements
    private toolbar: HTMLElement | null = null;
    private epsilonInput: HTMLInputElement | null = null;
    private marginTopInput: HTMLInputElement | null = null;
    private marginBottomInput: HTMLInputElement | null = null;

    // Drawing settings
    private widthMultiplier = 1.0;
    private pressureSensitivity = true;
    private smoothing = 0.3;
    private epsilon = 1.0; // For curve reduction

    private useColorForStyling = true;

    // Block height expansion
    private readonly BLOCK_EXPANSION_THRESHOLD = 50; // pixels
    private readonly BLOCK_EXPANSION_AMOUNT = 100; // pixels

    constructor(leaf: WorkspaceLeaf, plugin: VectorInkPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return INK_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename ?? 'Ink Document';
    }

    async onOpen(): Promise<void> {
        await this.loadDocument(); // Dokument laden
        this.blocks = this.document ? [...this.document.blocks].sort((a, b) => a.order - b.order) : [];
        this.contentEl.empty();
        await this.setupUI();
    }

    async onClose(): Promise<void> {
        // Dokument automatisch speichern beim Schließen
        try {
            await this.saveDocument();
        } catch (error) {
            console.error('Failed to save on close:', error);
        }

        // Event Listener aufräumen
        const handleKeyDown = (this as any)._handleKeyDown;
        if (handleKeyDown) {
            document.removeEventListener('keydown', handleKeyDown);
        }
    }

    private cleanupOrphanedStrokes(): void {
        if (!this.document) return;

        // Alle verwendeten Stroke-IDs sammeln
        const usedStrokeIds = new Set<string>();
        this.blocks.forEach(block => {
            block.strokeIds.forEach(id => usedStrokeIds.add(id));
        });

        // Alle Strokes im Dokument durchgehen
        const allStrokes = this.document.strokes;
        const orphanedStrokes = allStrokes.filter(stroke =>
            !usedStrokeIds.has(stroke.id)
        );

        if (orphanedStrokes.length > 0) {
            console.log(`🧹 Cleaning up ${orphanedStrokes.length} orphaned strokes`);
            orphanedStrokes.forEach(stroke => {
                this.document!.removeStroke(stroke.id);
            });
        }
    }

    /* ------------------ UI Setup ------------------ */

    async setupUI(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.classList.add('ink-view-container');
        this.contentEl.style.backgroundColor = 'var(--background-primary)';

        // Main layout
        const main = document.createElement('div');
        main.style.display = 'flex';
        main.style.flexDirection = 'column';
        main.style.height = '100%';
        main.style.overflow = 'hidden';
        main.style.backgroundColor = 'var(--background-primary)';
        this.contentEl.appendChild(main);

        // Create toolbar
        this.createToolbar(main);

        // Create blocks container with scrolling
        this.blocksContainer = document.createElement('div');
        this.blocksContainer.style.flex = '1';
        this.blocksContainer.style.overflow = 'auto';
        this.blocksContainer.style.padding = '20px';
        this.blocksContainer.style.backgroundColor = 'var(--background-primary)';
        main.appendChild(this.blocksContainer);

        // Load blocks
        if (this.document) {
            this.blocks = [...this.document.blocks].sort((a, b) => a.order - b.order);
            if (this.blocks.length === 0) {
                this.addNewBlock('paragraph', 0, true);
            }
        }

        // Initiales Rendering
        this.renderBlocks();

        // Event Listener
        this.setupEventListeners();

        // Theme Observer nur einmal aufsetzen
        this.setupThemeObserver();
    }

    createToolbar(container: HTMLElement): void {
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'ink-toolbar';
        this.toolbar.style.display = 'flex';
        this.toolbar.style.gap = '10px';
        this.toolbar.style.padding = '10px';
        this.toolbar.style.borderBottom = '1px solid var(--background-modifier-border)';
        this.toolbar.style.flexWrap = 'wrap';
        this.toolbar.style.alignItems = 'center';
        this.toolbar.style.background = 'var(--background-primary)'; // Theme-Anpassung

        // Save button
        const saveBtn = this.createToolbarButton('💾', 'Save', () => this.saveDocument());
        this.toolbar.appendChild(saveBtn);

        // Tools section
        this.toolbar.appendChild(this.createSeparator());
        this.toolbar.appendChild(this.createToolbarButton('✏️', 'Pen', () => this.setTool('pen')));
        this.toolbar.appendChild(this.createToolbarButton('🧽', 'Eraser', () => this.setTool('eraser')));
        this.toolbar.appendChild(this.createToolbarButton('↖️', 'Select', () => this.setTool('selection')));

        // Pen settings
        this.toolbar.appendChild(this.createSeparator());

        // Color picker - WICHTIG: Dieses Element fehlte
        const colorLabel = document.createElement('span');
        colorLabel.textContent = 'Color:';
        colorLabel.style.fontSize = '12px';
        this.toolbar.appendChild(colorLabel);

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = this.getThemeAdaptiveColor('#000000');
        colorInput.style.width = '30px';
        colorInput.style.height = '30px';
        colorInput.style.cursor = 'pointer';
        colorInput.style.verticalAlign = 'middle';
        colorInput.onchange = (e) => {
            const selectedColor = (e.target as HTMLInputElement).value;
            this.currentPenStyle.color = selectedColor;
            // Aktualisiere die Standardstift-Farbvorschläge basierend auf Theme
            this.updateThemeColors();
        };
        this.toolbar.appendChild(colorInput); // WICHTIG: Dies war vergessen

        // Opacity slider - nur für drawing blocks relevant
        const opacityLabel = document.createElement('span');
        opacityLabel.textContent = 'Opacity:';
        opacityLabel.style.fontSize = '12px';
        this.toolbar.appendChild(opacityLabel);

        const opacityInput = document.createElement('input');
        opacityInput.type = 'range';
        opacityInput.min = '0';
        opacityInput.max = '100';
        opacityInput.value = '100';
        opacityInput.style.width = '60px';
        opacityInput.style.verticalAlign = 'middle';
        opacityInput.onchange = (e) => {
            this.currentPenStyle.opacity = parseInt((e.target as HTMLInputElement).value) / 100;
        };
        this.toolbar.appendChild(opacityInput);

        // Width slider - nur für drawing blocks relevant
        const widthLabel = document.createElement('span');
        widthLabel.textContent = 'Width:';
        widthLabel.style.fontSize = '12px';
        this.toolbar.appendChild(widthLabel);

        const widthInput = document.createElement('input');
        widthInput.type = 'range';
        widthInput.min = '1';
        widthInput.max = '20';
        widthInput.value = '2';
        widthInput.style.width = '60px';
        widthInput.style.verticalAlign = 'middle';
        widthInput.onchange = (e) => {
            this.currentPenStyle.width = parseInt((e.target as HTMLInputElement).value);
        };
        this.toolbar.appendChild(widthInput);

        // Formatting (Semantic)
        this.toolbar.appendChild(this.createSeparator());
        const formatContainer = document.createElement('div');
        formatContainer.style.display = 'flex';
        formatContainer.style.gap = '5px';

        const normalBtn = this.createFormatButton('Normal', 'normal');
        const boldBtn = this.createFormatButton('B', 'bold');
        const italicBtn = this.createFormatButton('I', 'italic');

        formatContainer.appendChild(normalBtn);
        formatContainer.appendChild(boldBtn);
        formatContainer.appendChild(italicBtn);
        this.toolbar.appendChild(formatContainer);

        // Color Toggle
        this.toolbar.appendChild(this.createSeparator());

        const colorToggleContainer = document.createElement('div');
        colorToggleContainer.style.display = 'flex';
        colorToggleContainer.style.alignItems = 'center';
        colorToggleContainer.style.gap = '5px';

        const colorToggleLabel = document.createElement('span');
        colorToggleLabel.textContent = 'Use Color:';
        colorToggleLabel.style.fontSize = '12px';
        colorToggleContainer.appendChild(colorToggleLabel);

        const colorToggle = document.createElement('input');
        colorToggle.type = 'checkbox';
        colorToggle.checked = this.useColorForStyling;
        colorToggle.style.transform = 'scale(0.9)';
        colorToggle.style.verticalAlign = 'middle';
        colorToggle.onchange = (e) => {
            this.useColorForStyling = (e.target as HTMLInputElement).checked;
            this.renderBlocks(); // Alle Blöcke neu zeichnen
            new Notice(this.useColorForStyling ? 'Using color for styling' : 'Using block-based styling');
        };
        colorToggleContainer.appendChild(colorToggle);

        this.toolbar.appendChild(colorToggleContainer);

        // width multiplier
        // Width Multiplier Einstellung - verbessere die onChange Funktion
        const widthMultiplierInput = document.createElement('input');
        widthMultiplierInput.type = 'range';
        widthMultiplierInput.min = '0.5';
        widthMultiplierInput.max = '4.0';
        widthMultiplierInput.step = '0.1';
        widthMultiplierInput.value = '1';
        widthMultiplierInput.style.width = '60px';
        widthMultiplierInput.style.verticalAlign = 'middle';

        // Füge eine Anzeige für den aktuellen Wert hinzu
        const multiplierValue = document.createElement('span');
        multiplierValue.textContent = ` (${widthMultiplierInput.value}x)`;
        multiplierValue.style.fontSize = '12px';

        widthMultiplierInput.oninput = (e) => {
            const value = parseFloat((e.target as HTMLInputElement).value);
            this.widthMultiplier = value;
            multiplierValue.textContent = ` (${value.toFixed(1)}x)`;

            // Aktualisiere die Canvas-Anzeige
            this.redrawAllBlocks();
        };

        widthMultiplierInput.onchange = (e) => {
            const value = parseFloat((e.target as HTMLInputElement).value);
            this.widthMultiplier = value;
            multiplierValue.textContent = ` (${value.toFixed(1)}x)`;
            this.redrawAllBlocks();
        };

        this.toolbar.appendChild(widthMultiplierInput);
        this.toolbar.appendChild(multiplierValue);

        // Epsilon setting
        this.toolbar.appendChild(this.createSeparator());
        const epsilonLabel = document.createElement('span');
        epsilonLabel.textContent = 'Epsilon:';
        this.toolbar.appendChild(epsilonLabel);

        this.epsilonInput = document.createElement('input');
        this.epsilonInput.type = 'number';
        this.epsilonInput.value = '1.0';
        this.epsilonInput.step = '0.1';
        this.epsilonInput.min = '0.1';
        this.epsilonInput.max = '10';
        this.epsilonInput.style.width = '60px';
        this.epsilonInput.onchange = (e) => {
            this.epsilon = parseFloat((e.target as HTMLInputElement).value);
        };
        this.toolbar.appendChild(this.epsilonInput);

        // Margin settings
        this.toolbar.appendChild(this.createSeparator());
        const marginLabel = document.createElement('span');
        marginLabel.textContent = 'Margins:';
        this.toolbar.appendChild(marginLabel);

        const marginContainer = document.createElement('div');
        marginContainer.style.display = 'flex';
        marginContainer.style.gap = '5px';

        const topLabel = document.createElement('span');
        topLabel.textContent = 'T:';
        marginContainer.appendChild(topLabel);

        this.marginTopInput = document.createElement('input');
        this.marginTopInput.type = 'number';
        this.marginTopInput.value = '8'; // Reduzierter Standardwert
        this.marginTopInput.min = '0';
        this.marginTopInput.max = '50'; // Reduziertes Maximum
        this.marginTopInput.step = '1';
        this.marginTopInput.style.width = '50px';
        this.marginTopInput.onchange = (e) => {
            this.blockMargins.top = parseInt((e.target as HTMLInputElement).value);
            this.updateBlockMargins();
        };
        marginContainer.appendChild(this.marginTopInput);

        const bottomLabel = document.createElement('span');
        bottomLabel.textContent = 'B:';
        marginContainer.appendChild(bottomLabel);

        this.marginBottomInput = document.createElement('input');
        this.marginBottomInput.type = 'number';
        this.marginBottomInput.value = '8'; // Reduzierter Standardwert
        this.marginBottomInput.min = '0';
        this.marginBottomInput.max = '50'; // Reduziertes Maximum
        this.marginBottomInput.step = '1';
        this.marginBottomInput.style.width = '50px';
        this.marginBottomInput.onchange = (e) => {
            this.blockMargins.bottom = parseInt((e.target as HTMLInputElement).value);
            this.updateBlockMargins();
        };
        marginContainer.appendChild(this.marginBottomInput);

        this.toolbar.appendChild(marginContainer);

        // Digitalize button
        this.toolbar.appendChild(this.createSeparator());
        const digitalizeBtn = this.createToolbarButton('⚡', 'Digitalize', () => this.digitalizeCurrentDocument());
        this.toolbar.appendChild(digitalizeBtn);

        // Add block button
        const addBlockBtn = this.createToolbarButton('＋', 'Add Block', () => this.addNewBlock('paragraph', this.blocks.length));
        this.toolbar.appendChild(addBlockBtn);

        container.appendChild(this.toolbar);
    }

    private createToolbarButton(icon: string, title: string, onClick: () => void): HTMLElement {
        const button = document.createElement('button');
        button.innerHTML = icon;
        button.title = title;
        button.style.padding = '5px 10px';
        button.style.border = '1px solid var(--background-modifier-border)';
        button.style.borderRadius = '4px';
        button.style.background = 'var(--background-primary)';
        button.style.cursor = 'pointer';
        button.onclick = onClick;
        return button;
    }

    private createFormatButton(text: string, semantic: string): HTMLElement {
        const button = document.createElement('button');
        button.textContent = text;
        button.style.padding = '5px 10px';
        button.style.border = '1px solid var(--background-modifier-border)';
        button.style.borderRadius = '4px';
        button.style.fontWeight = semantic === 'bold' ? 'bold' : 'normal';
        button.style.fontStyle = semantic === 'italic' ? 'italic' : 'normal';
        button.onclick = () => {
            this.currentPenStyle.semantic = semantic as any;
            // Update button states
            button.parentElement?.querySelectorAll('button').forEach(btn => {
                btn.classList.remove('active');
            });
            button.classList.add('active');
        };
        return button;
    }

    private createSeparator(): HTMLElement {
        const separator = document.createElement('div');
        separator.style.width = '1px';
        separator.style.height = '20px';
        separator.style.background = 'var(--background-modifier-border)';
        separator.style.margin = '0 5px';
        return separator;
    }

    /* ------------------ Block Management ------------------ */

    private renderBlocks(): void {
        if (!this.blocksContainer) return;

        this.blocksContainer.empty();
        this.blocks.sort((a, b) => a.order - b.order);

        this.blocks.forEach((block, index) => {
            const blockElement = this.createBlockElement(block, index);
            this.blocksContainer!.appendChild(blockElement);
        });
    }

    private createBlockElement(block: Block, index: number): HTMLElement {
        const isSelected = index === this.currentBlockIndex;

        const blockEl = document.createElement('div');
        blockEl.className = 'ink-block';
        blockEl.dataset.blockId = block.id;
        blockEl.dataset.selected = isSelected.toString();
        blockEl.style.position = 'relative';
        blockEl.style.marginTop = `${isSelected ? Math.max(this.blockMargins.top, 12) : this.blockMargins.top}px`;
        blockEl.style.marginBottom = `${isSelected ? Math.max(this.blockMargins.bottom, 12) : this.blockMargins.bottom}px`;
        blockEl.style.border = isSelected ? '2px solid var(--interactive-accent)' : '1px solid var(--background-modifier-border)';
        blockEl.style.borderRadius = '6px';
        blockEl.style.background = 'var(--background-primary)';
        blockEl.style.padding = isSelected ? '15px' : '8px';
        blockEl.style.minHeight = isSelected ? '150px' : '100px';
        blockEl.style.transition = 'all 0.2s ease';
        blockEl.style.boxShadow = isSelected ? '0 2px 8px rgba(0,0,0,0.1)' : 'none';

        // Block header - NUR bei ausgewähltem Block
        if (isSelected) {
            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.marginBottom = '10px';
            header.style.paddingBottom = '5px';
            header.style.borderBottom = '1px solid var(--background-modifier-border)';
            header.style.minHeight = '32px';

            // Block type selector
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
                this.updateBlock({ id: block.id, type: newType });
                this.renderBlocks();
            };

            header.appendChild(typeSelector);

            // Block controls
            const controls = document.createElement('div');
            controls.style.display = 'flex';
            controls.style.gap = '5px';
            controls.style.flexShrink = '0';

            // Move up button
            const upBtn = this.createBlockControlButton('↑', 'Move up', () => this.moveBlockUp(index));
            upBtn.style.display = index === 0 ? 'none' : 'block';
            controls.appendChild(upBtn);

            // Move down button
            const downBtn = this.createBlockControlButton('↓', 'Move down', () => this.moveBlockDown(index));
            downBtn.style.display = index === this.blocks.length - 1 ? 'none' : 'block';
            controls.appendChild(downBtn);

            // Separator
            const separator = document.createElement('span');
            separator.style.margin = '0 5px';
            separator.style.color = 'var(--background-modifier-border)';
            separator.textContent = '|';
            controls.appendChild(separator);

            // Clear button
            const clearBtn = this.createBlockControlButton('🗑️', 'Clear block', () => this.clearBlock(block.id));
            controls.appendChild(clearBtn);

            // Delete button
            const deleteBtn = this.createBlockControlButton('✕', 'Delete block', () => this.deleteBlock(block.id));
            deleteBtn.style.color = 'var(--text-error)';
            deleteBtn.style.display = this.blocks.length > 1 ? 'block' : 'none';
            controls.appendChild(deleteBtn);

            header.appendChild(controls);
            blockEl.appendChild(header);
        } else {
            // Mini-Header für nicht-ausgewählte Blöcke (nur Typ-Icon)
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

        // Canvas for drawing
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

        // Setup drawing events
        this.setupCanvasEvents(canvas, index);

        // Draw existing strokes
        this.drawBlockStrokes(canvas, block);

        blockEl.appendChild(canvas);

        // Add Block Buttons - NUR bei ausgewähltem Block
        if (isSelected) {
            // Button oberhalb des Canvas
            const addBlockAboveBtn = this.createAddBlockButton('above', index);
            blockEl.insertBefore(addBlockAboveBtn, canvas);

            // Button unterhalb des Canvas
            const addBlockBelowBtn = this.createAddBlockButton('below', index);
            blockEl.appendChild(addBlockBelowBtn);
        }

        // Block click handler
        blockEl.onclick = (e) => {
            const target = e.target as HTMLElement;
            if (!target.closest('select, button, input')) {
                this.currentBlockIndex = index;
                this.renderBlocks();
            }
        };

        // Doppelklick zum Bearbeiten auch für nicht-ausgewählte Blöcke
        blockEl.ondblclick = (e) => {
            this.currentBlockIndex = index;
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

        // Füge eine dezente Linie hinzu
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

        // Hover-Effekt
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

    private addNewBlockAtPosition(type: BlockType, position: number): void {
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

        // Block an Position einfügen
        this.blocks.splice(position, 0, newBlock);

        // Orders neu berechnen
        this.blocks.forEach((b, idx) => {
            b.order = idx;
        });

        // Neuen Block auswählen
        this.currentBlockIndex = position;
        this.renderBlocks();

        // Automatisch scrollen, damit der neue Block sichtbar ist
        setTimeout(() => {
            const blockEl = this.blocksContainer?.querySelector(`.ink-block[data-block-id="${newBlock.id}"]`);
            if (blockEl) {
                blockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 50);
    }

    private addNewBlock(type: BlockType, order: number, select = false): void {
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

        this.blocks.push(newBlock);

        // Reindex all blocks
        this.blocks.forEach((block, idx) => {
            block.order = idx;
        });

        if (select) {
            this.currentBlockIndex = this.blocks.length - 1;
        }

        this.renderBlocks();
    }

    private moveBlockUp(index: number): void {
        if (index <= 0) return;

        const currentBlock = this.blocks[index];
        const previousBlock = this.blocks[index - 1];

        if (!currentBlock || !previousBlock) return;

        // Swap positions
        const tempOrder = currentBlock.order;
        currentBlock.order = previousBlock.order;
        previousBlock.order = tempOrder;

        this.blocks[index] = previousBlock;
        this.blocks[index - 1] = currentBlock;

        this.currentBlockIndex = index - 1;
        this.renderBlocks();
    }

    private moveBlockDown(index: number): void {
        if (index >= this.blocks.length - 1) return;

        const currentBlock = this.blocks[index];
        const nextBlock = this.blocks[index + 1];

        if (!currentBlock || !nextBlock) return;

        const tempOrder = currentBlock.order;
        currentBlock.order = nextBlock.order;
        nextBlock.order = tempOrder;

        this.blocks[index] = nextBlock;
        this.blocks[index + 1] = currentBlock;

        this.currentBlockIndex = index + 1;
        this.renderBlocks();
    }

    private clearBlock(blockId: string): void {
        const blockIndex = this.blocks.findIndex(b => b.id === blockId);
        if (blockIndex >= 0) {
            const block = this.blocks[blockIndex];
            if (block && this.document) {
                // Alle Strokes des Blocks aus dem Dokument entfernen
                block.strokeIds.forEach(strokeId => {
                    if (this.document) { // Nullprüfung hinzufügen
                        this.document.removeStroke(strokeId);
                    }
                });

                // Block leeren
                block.strokeIds = [];

                // Canvas neu zeichnen (leer)
                const canvas = this.getCanvasForBlock(blockId);
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        const isDark = this.isDarkTheme();
                        ctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }
                }

                // Blockgröße auf Standard zurücksetzen
                const isSelected = blockIndex === this.currentBlockIndex;
                block.bbox.width = 760;
                block.bbox.height = isSelected ? 200 : 120;

                // Canvas-Größe aktualisieren
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

                // Block-Element-Höhe aktualisieren
                const blockEl = this.blocksContainer?.querySelector(`.ink-block[data-block-id="${blockId}"]`) as HTMLElement;
                if (blockEl) {
                    blockEl.style.minHeight = `${block.bbox.height + (isSelected ? 100 : 50)}px`;
                }

                this.renderBlocks();
                new Notice('Block cleared');
            }
        }
    }

    private deleteBlock(blockId: string): void {
        const blockIndex = this.blocks.findIndex(b => b.id === blockId);
        if (blockIndex >= 0) {
            const block = this.blocks[blockIndex];

            // Strokes aus dem Dokument entfernen
            if (block && this.document) {
                block.strokeIds.forEach(strokeId => {
                    if (this.document) { // Nullprüfung hinzufügen
                        this.document.removeStroke(strokeId);
                    }
                });
            }

            // Block aus der Liste entfernen
            this.blocks.splice(blockIndex, 1);

            // Order neu nummerieren
            this.blocks.forEach((b, idx) => b.order = idx);

            // Aktuellen Index anpassen
            this.currentBlockIndex = Math.min(
                Math.max(0, this.currentBlockIndex - 1),
                this.blocks.length - 1
            );

            this.renderBlocks();
            new Notice('Block deleted');
        }
    }

    private updateBlockMargins(): void {
        if (!this.blocksContainer) return;

        const blocks = this.blocksContainer.querySelectorAll('.ink-block');
        blocks.forEach((block: HTMLElement, index) => {
            const isSelected = index === this.currentBlockIndex;
            const marginTop = isSelected ?
                Math.max(this.blockMargins.top, 12) : // Etwas mehr Platz für ausgewählte Blöcke
                this.blockMargins.top;
            const marginBottom = isSelected ?
                Math.max(this.blockMargins.bottom, 12) : // Etwas mehr Platz für ausgewählte Blöcke
                this.blockMargins.bottom;

            block.style.marginTop = `${marginTop}px`;
            block.style.marginBottom = `${marginBottom}px`;
        });
    }

    async onFileChange(newFile: TFile) {
        this.file = newFile;
        await this.loadDocument();
        this.blocks = this.document ? [...this.document.blocks].sort((a, b) => a.order - b.order) : [];
        await this.setupUI();
    }

    /* ------------------ Drawing ------------------ */

    private setupCanvasEvents(canvas: HTMLCanvasElement, blockIndex: number): void {
        let lastPoint: Point | null = null;
        let lastErasePoint: Point | null = null; // Für kontinuierliches Radieren

        const getPoint = (e: MouseEvent | TouchEvent): Point | null => {
            const rect = canvas.getBoundingClientRect();

            if ('touches' in e) {
                if (e.touches.length === 0) return null;
                const touch = e.touches[0];
                if (!touch) return null;

                return {
                    x: (touch.clientX - rect.left) * (canvas.width / rect.width),
                    y: (touch.clientY - rect.top) * (canvas.height / rect.height),
                    t: Date.now(),
                    pressure: 0.5 // Default pressure for mouse
                };
            } else {
                return {
                    x: (e.clientX - rect.left) * (canvas.width / rect.width),
                    y: (e.clientY - rect.top) * (canvas.height / rect.height),
                    t: Date.now(),
                    pressure: 0.5 // Default pressure for mouse
                };
            }
        };

        const startDrawing = (point: Point) => {
            if (blockIndex !== this.currentBlockIndex) return;

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
            if (!this.isDrawing || blockIndex !== this.currentBlockIndex) return;

            const ctx = canvas.getContext('2d');
            if (!ctx || !lastPoint) return;

            // Add point to current stroke
            this.currentStroke.push(point);

            // Beginne neuen Pfad für jeden Strich-Abschnitt
            ctx.beginPath();
            ctx.moveTo(lastPoint.x, lastPoint.y);
            ctx.lineTo(point.x, point.y);

            // Stil basierend auf Block-Typ berechnen
            const currentBlock = this.blocks[this.currentBlockIndex];
            if (currentBlock) {
                const displayStyle = this.getCalculatedStrokeStyle(
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

            // Check for auto-expansion
            this.checkAutoExpand(canvas, point);
        };

        const stopDrawing = () => {
            if (!this.isDrawing || !this.document) return;

            this.isDrawing = false;
            if (this.currentStroke.length < 2) return;

            const block = this.blocks[this.currentBlockIndex];
            if (!block) return;

            const simplifiedPoints = this.simplifyStroke(this.currentStroke, this.epsilon);
            const stroke: Stroke = {
                id: crypto.randomUUID(),
                points: simplifiedPoints,
                style: { ...this.currentPenStyle },
                createdAt: new Date().toISOString()
            };

            const addedStroke = this.document.addStroke(stroke);
            block.strokeIds.push(addedStroke.id);

            this.updateBlockBoundingBox(block, simplifiedPoints);
            this.syncBlockStrokes(block);

            this.currentStroke = [];
            lastPoint = null;
        };

        const startErasing = (point: Point) => {
            if (blockIndex !== this.currentBlockIndex) return;

            this.isErasing = true;
            lastErasePoint = point;

            // Sofort am Startpunkt radieren
            this.eraseAtPoint(canvas, blockIndex, point);
        };

        const erase = (point: Point) => {
            if (!this.isErasing || blockIndex !== this.currentBlockIndex) return;

            // Kontinuierliches Radieren zwischen Punkten
            if (lastErasePoint) {
                // Interpoliere Punkte zwischen letztem und aktuellem Punkt
                const distance = Math.sqrt(
                    Math.pow(point.x - lastErasePoint.x, 2) +
                    Math.pow(point.y - lastErasePoint.y, 2)
                );

                // Erhöhe die Dichte der Radierpunkte basierend auf Geschwindigkeit
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
                // Fallback: Einzelpunkt radieren
                this.eraseAtPoint(canvas, blockIndex, point);
            }

            lastErasePoint = point;
        };

        const stopErasing = () => {
            this.isErasing = false;
            lastErasePoint = null;

            // Blockgröße nach dem Radieren anpassen
            const block = this.blocks[blockIndex];
            if (block) {
                setTimeout(() => {
                    this.adjustBlockSize(block.id);
                }, 50);
            }
        };

        // Mouse events
        const handleMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return; // Only left click

            const point = getPoint(e);
            if (!point) return;

            if (this.currentTool === 'eraser') {
                startErasing(point);
            } else if (this.currentTool === 'pen') {
                startDrawing(point);
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            const point = getPoint(e);
            if (!point) return;

            if (this.currentTool === 'eraser' && this.isErasing) {
                erase(point);
            } else if (this.currentTool === 'pen' && this.isDrawing) {
                draw(point);
            }
        };

        const handleMouseUp = () => {
            if (this.currentTool === 'pen') {
                stopDrawing();
            } else if (this.currentTool === 'eraser') {
                stopErasing();
            }
        };

        const handleMouseLeave = () => {
            if (this.currentTool === 'pen') {
                stopDrawing();
            } else if (this.currentTool === 'eraser') {
                stopErasing();
            }
        };

        canvas.onmousedown = handleMouseDown;
        canvas.onmousemove = handleMouseMove;
        canvas.onmouseup = handleMouseUp;
        canvas.onmouseleave = handleMouseLeave;

        // Touch events for mobile/stylus
        const handleTouchStart = (e: TouchEvent) => {
            e.preventDefault();
            const point = getPoint(e);
            if (point) {
                if (this.currentTool === 'eraser') {
                    startErasing(point);
                } else if (this.currentTool === 'pen') {
                    startDrawing(point);
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
                    draw(point);
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
        };

        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
        canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    }

    private expandBlockDownwards(canvas: HTMLCanvasElement, block: Block, point: Point): void {
        const padding = 50;
        const threshold = 30; // Weniger aggressiver Schwellenwert

        // Prüfen, ob Punkt nahe am unteren Rand ist
        if (point.y > block.bbox.height - threshold) {
            // Berechne benötigte zusätzliche Höhe
            const additionalHeight = Math.max(
                this.BLOCK_EXPANSION_AMOUNT,
                point.y - block.bbox.height + padding
            );

            const newHeight = block.bbox.height + additionalHeight;

            // Canvas-Größe speichern
            const oldWidth = block.bbox.width;
            const oldHeight = block.bbox.height;

            // Block-Höhe aktualisieren
            block.bbox.height = newHeight;

            // Canvas physikalische Größe anpassen
            const dpr = window.devicePixelRatio || 1;
            canvas.width = block.bbox.width * dpr;
            canvas.height = block.bbox.height * dpr;

            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.scale(dpr, dpr);
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                // Alte Strokes komplett neu zeichnen
                this.drawBlockStrokes(canvas, block);

                // Aktuellen Stroke fortsetzen (wenn vorhanden)
                if (this.isDrawing && this.currentStroke.length > 0) {
                    ctx.beginPath();
                    const firstPoint = this.currentStroke[0];
                    if (firstPoint) {
                        ctx.moveTo(firstPoint.x, firstPoint.y);

                        for (let i = 1; i < this.currentStroke.length; i++) {
                            const p = this.currentStroke[i];
                            if (p) {
                                ctx.lineTo(p.x, p.y);
                            }
                        }

                        // Stil anwenden
                        const displayStyle = this.getCalculatedStrokeStyle(
                            block.type,
                            this.currentPenStyle
                        );

                        ctx.strokeStyle = displayStyle.color;
                        ctx.globalAlpha = displayStyle.opacity || 1;
                        ctx.lineWidth = displayStyle.width;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        ctx.stroke();
                    }
                }
            }

            // CSS-Größe aktualisieren
            canvas.style.width = `${block.bbox.width}px`;
            canvas.style.height = `${block.bbox.height}px`;

            // Block-Element-Höhe anpassen
            const blockEl = canvas.closest('.ink-block') as HTMLElement;
            if (blockEl) {
                blockEl.style.minHeight = `${block.bbox.height + 100}px`; // Extra Raum für Controls
            }

            console.log(`Block expanded: ${oldHeight} -> ${newHeight}px`);
        }
    }

    private updateBlockCanvasSize(block: Block, canvas: HTMLCanvasElement) {
        if (!this.document) return;

        const scrollBefore = this.blocksContainer?.scrollTop ?? 0;

        let maxY = 0;
        for (const strokeId of block.strokeIds) {
            const stroke = this.document.getStroke(strokeId);
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

        if (this.blocksContainer) {
            this.blocksContainer.scrollTop = scrollBefore;
        }
    }

    private syncBlockStrokes(block: Block): void {
        if (!this.document) return;

        // Alle Strokes im Dokument, die zu diesem Block gehören sollten
        const allStrokeIds = block.strokeIds;

        // Strokes, die im Dokument sind aber nicht im Block
        const strokesToRemove: string[] = [];

        // Überprüfe alle Strokes im Dokument
        for (const stroke of this.document.strokes) {
            // Wenn Stroke nicht in block.strokeIds ist, aber zu diesem Block gehört
            // (Dies ist ein vereinfachtes Beispiel - Sie benötigen eine bessere Zuordnungslogik)
            if (!allStrokeIds.includes(stroke.id)) {
                // Prüfe, ob der Stroke innerhalb der Block-BBox liegt
                const firstPoint = stroke.points[0];
                if (firstPoint) {
                    if (firstPoint.x >= block.bbox.x &&
                        firstPoint.x <= block.bbox.x + block.bbox.width &&
                        firstPoint.y >= block.bbox.y &&
                        firstPoint.y <= block.bbox.y + block.bbox.height) {
                        // Stroke gehört zu diesem Block, aber ist nicht in der Liste
                        // Nichts tun oder zur Liste hinzufügen
                    }
                }
            }
        }
    }

    private drawBlockStrokes(canvas: HTMLCanvasElement, block: Block): void {
        if (!this.document) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Canvas leeren
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Canvas-Hintergrund an Theme anpassen
        const isDark = this.isDarkTheme();
        ctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (const strokeId of block.strokeIds) {
            const stroke = this.document.strokes.find(s => s.id === strokeId);
            if (!stroke || stroke.points.length < 2) continue;

            const first = stroke.points[0];
            if (!first) continue;

            ctx.beginPath();
            ctx.moveTo(first.x, first.y);

            for (let i = 1; i < stroke.points.length; i++) {
                const p = stroke.points[i];
                if (p) {
                    ctx.lineTo(p.x, p.y);
                }
            }

            // Stil basierend auf Block-Typ berechnen
            const displayStyle = this.getCalculatedStrokeStyle(block.type, stroke.style);

            ctx.strokeStyle = displayStyle.color;
            ctx.globalAlpha = displayStyle.opacity || 1;
            ctx.lineWidth = displayStyle.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        }
    }

    private simplifyStroke(points: Point[], epsilon: number): Point[] {
        if (points.length <= 2) return points;

        const findFurthestPoint = (points: Point[], start: number, end: number): number => {
            let maxDistance = 0;
            let index = start;

            const startPoint = points[start];
            const endPoint = points[end];
            if (!startPoint || !endPoint) return -1;

            for (let i = start + 1; i < end; i++) {
                const point = points[i];
                if (!point) continue;
                const distance = this.perpendicularDistance(point, startPoint, endPoint);
                if (distance > maxDistance) {
                    maxDistance = distance;
                    index = i;
                }
            }

            return maxDistance > epsilon ? index : -1;
        };

        const douglasPeucker = (points: Point[], start: number, end: number, epsilon: number): Point[] => {
            const startPoint = points[start];
            const endPoint = points[end];
            if (!startPoint || !endPoint) return [startPoint, endPoint].filter(Boolean) as Point[];

            const furthest = findFurthestPoint(points, start, end);

            if (furthest === -1) {
                return [startPoint, endPoint];
            }

            const left = douglasPeucker(points, start, furthest, epsilon);
            const right = douglasPeucker(points, furthest, end, epsilon);

            return left.slice(0, -1).concat(right);
        };

        return douglasPeucker(points, 0, points.length - 1, epsilon);
    }

    private perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
        const area = Math.abs(
            (lineEnd.x - lineStart.x) * (lineStart.y - point.y) -
            (lineStart.x - point.x) * (lineEnd.y - lineStart.y)
        );

        const lineLength = Math.sqrt(
            Math.pow(lineEnd.x - lineStart.x, 2) +
            Math.pow(lineEnd.y - lineStart.y, 2)
        );

        return lineLength === 0 ? 0 : area / lineLength;
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

        // Add some padding
        const padding = 10;
        block.bbox.x = Math.min(block.bbox.x, minX - padding);
        block.bbox.y = Math.min(block.bbox.y, minY - padding);
        block.bbox.width = Math.max(block.bbox.width, maxX - block.bbox.x + padding);
        block.bbox.height = Math.max(block.bbox.height, maxY - block.bbox.y + padding);
    }

    private checkAutoExpand(canvas: HTMLCanvasElement, point: Point): void {
        const block = this.blocks[this.currentBlockIndex];
        if (!block) return;

        // Nur erweitern, wenn wir zeichnen
        if (this.isDrawing && this.currentTool === 'pen') {
            this.expandBlockDownwards(canvas, block, point);
        }
    }

    private redrawAllBlocks(): void {
        if (!this.blocksContainer) return;

        const canvases = this.blocksContainer.querySelectorAll('canvas');
        canvases.forEach(canvas => {
            const blockId = canvas.closest('.ink-block')?.getAttribute('data-block-id');
            if (blockId) {
                const block = this.blocks.find(b => b.id === blockId);
                if (block) {
                    // Erhalte den Canvas-Kontext und zeichne neu
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        // Canvas leeren
                        ctx.clearRect(0, 0, canvas.width, canvas.height);

                        // Hintergrund neu zeichnen
                        const isDark = this.isDarkTheme();
                        ctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);

                        // Strokes neu zeichnen
                        this.drawBlockStrokes(canvas, block);
                    }
                }
            }
        });
    }

    private eraseAtPoint(canvas: HTMLCanvasElement, blockIndex: number, point: Point): void {
        const block = this.blocks[blockIndex];
        if (!block || !this.document) return;

        const eraserRadius = this.currentPenStyle.width * 5;
        const strokeIdsToRemove: string[] = [];
        let strokesRemoved = false;

        if (this.eraserMode === 'stroke') {
            // Finde alle Striche, die den Radierradius schneiden
            for (const strokeId of block.strokeIds) {
                const stroke = this.document.strokes.find(s => s.id === strokeId);
                if (!stroke) continue;

                let strokeRemoved = false;

                // Prüfe jeden Punkt im Strich
                for (const p of stroke.points) {
                    const distance = Math.sqrt(
                        Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2)
                    );

                    if (distance <= eraserRadius) {
                        strokeIdsToRemove.push(strokeId);
                        strokeRemoved = true;
                        strokesRemoved = true;
                        break; // Einmal gefunden reicht
                    }
                }

                // Falls der Strich sehr kurz ist, prüfe auch den Linienverlauf
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
            // Punkt-für-Punkt Radieren
            for (const strokeId of block.strokeIds) {
                const stroke = this.document.strokes.find(s => s.id === strokeId);
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

        // Entferne Striche aus Block
        if (strokeIdsToRemove.length > 0) {
            const beforeCount = block.strokeIds.length;
            block.strokeIds = block.strokeIds.filter(id => !strokeIdsToRemove.includes(id));
            const removedCount = beforeCount - block.strokeIds.length;

            // Entferne auch aus dem Dokument
            strokeIdsToRemove.forEach(strokeId => {
                this.document?.removeStroke(strokeId);
            });

            // Redraw the block sofort
            this.drawBlockStrokes(canvas, block);

            // Blockgröße anpassen, wenn Striche entfernt wurden
            if (strokesRemoved) {
                setTimeout(() => {
                    this.adjustBlockSize(block.id);
                }, 100); // Kurze Verzögerung für bessere Performance
            }

            // Debug-Ausgabe
            // console.log(`Erased ${removedCount} strokes at (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`);
        }
    }

    // Hilfsmethode für Abstand zu Liniensegment
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

    private getCanvasForBlock(blockId: string): HTMLCanvasElement | null {
        if (!this.blocksContainer) return null;
        const blockEl = this.blocksContainer.querySelector(`.ink-block[data-block-id="${blockId}"]`);
        if (!blockEl) return null;
        return blockEl.querySelector('canvas') as HTMLCanvasElement;
    }

    private calculateOptimalBlockSize(block: Block): { width: number, height: number } {
    if (!this.document) {
        return { width: block.bbox.width, height: block.bbox.height };
    }
    
    const isSelected = this.blocks.findIndex(b => b.id === block.id) === this.currentBlockIndex;
    
    // Mindestgrößen definieren
    const MIN_WIDTH = 760;
    const MIN_HEIGHT_SELECTED = 200;  // Für ausgewählte Blöcke
    const MIN_HEIGHT_UNSELECTED = 150; // Für nicht-ausgewählte Blöcke
    const MIN_HEIGHT = isSelected ? MIN_HEIGHT_SELECTED : MIN_HEIGHT_UNSELECTED;
    
    // Wenn keine Striche vorhanden sind, Standardgröße zurückgeben
    if (block.strokeIds.length === 0) {
        return {
            width: MIN_WIDTH,
            height: MIN_HEIGHT
        };
    }
    
    // Bounding Box aller Striche berechnen
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let hasStrokes = false;
    
    for (const strokeId of block.strokeIds) {
        const stroke = this.document.strokes.find(s => s.id === strokeId);
        if (!stroke || stroke.points.length === 0) continue;
        
        hasStrokes = true;
        
        for (const point of stroke.points) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
    }
    
    // Wenn keine gültigen Punkte gefunden wurden
    if (!hasStrokes || minX === Infinity || maxX === -Infinity || minY === Infinity || maxY === -Infinity) {
        return {
            width: MIN_WIDTH,
            height: MIN_HEIGHT
        };
    }
    
    // Padding hinzufügen (mehr Padding für bessere Sichtbarkeit)
    const horizontalPadding = 80;
    const verticalPadding = 60;
    
    // Berechnete Größen
    let calculatedWidth = maxX - minX + horizontalPadding;
    let calculatedHeight = maxY - minY + verticalPadding;
    
    // Sicherstellen, dass wir Mindestgrößen einhalten
    calculatedWidth = Math.max(MIN_WIDTH, calculatedWidth);
    calculatedHeight = Math.max(MIN_HEIGHT, calculatedHeight);
    
    // Begrenze die maximale Größe (optional)
    const MAX_WIDTH = 1200;
    const MAX_HEIGHT = 800;
    calculatedWidth = Math.min(MAX_WIDTH, calculatedWidth);
    calculatedHeight = Math.min(MAX_HEIGHT, calculatedHeight);
    
    // Prüfen, ob eine Verkleinerung sinnvoll ist
    const currentHeight = block.bbox.height;
    const shrinkThreshold = 80; // Höhere Schwelle, um nicht zu oft zu verkleinern
    
    // Nur verkleinern, wenn der Block deutlich zu groß ist
    if (currentHeight - calculatedHeight > shrinkThreshold) {
        return {
            width: calculatedWidth,
            height: calculatedHeight
        };
    } else {
        // Behalte die aktuelle Größe bei, wenn die Differenz zu gering ist
        return {
            width: Math.max(block.bbox.width, MIN_WIDTH),
            height: Math.max(block.bbox.height, MIN_HEIGHT)
        };
    }
}

    private adjustBlockSize(blockId: string): void {
    const blockIndex = this.blocks.findIndex(b => b.id === blockId);
    if (blockIndex === -1) return;
    
    const block = this.blocks[blockIndex];
    const canvas = this.getCanvasForBlock(blockId);
    
    if (typeof block === 'undefined' || canvas === null) return;
    if (!canvas) return;
    
    // Optimale Größe berechnen
    const optimalSize = this.calculateOptimalBlockSize(block);
    
    // Nur aktualisieren, wenn sich die Größe signifikant ändert
    const widthChanged = Math.abs(block.bbox.width - optimalSize.width) > 20;
    const heightChanged = Math.abs(block.bbox.height - optimalSize.height) > 20;
    
    if (widthChanged || heightChanged) {
        // Größe aktualisieren
        block.bbox.width = optimalSize.width;
        block.bbox.height = optimalSize.height;
        
        // Canvas-Größe aktualisieren
        const dpr = window.devicePixelRatio || 1;
        const oldWidth = canvas.width;
        const oldHeight = canvas.height;
        
        canvas.width = block.bbox.width * dpr;
        canvas.height = block.bbox.height * dpr;
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.scale(dpr, dpr);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
        }
        
        // CSS-Größe aktualisieren
        canvas.style.width = `${block.bbox.width}px`;
        canvas.style.height = `${block.bbox.height}px`;
        
        // Strokes neu zeichnen
        this.drawBlockStrokes(canvas, block);
        
        // Block-Element-Höhe anpassen
        const blockEl = canvas.closest('.ink-block') as HTMLElement;
        if (blockEl) {
            const isSelected = blockIndex === this.currentBlockIndex;
            // Extra Raum für Controls hinzufügen
            const extraHeight = isSelected ? 120 : 80;
            blockEl.style.minHeight = `${block.bbox.height + extraHeight}px`;
        }
        
        console.log(`Block ${blockId} adjusted: ${oldWidth/dpr}x${oldHeight/dpr} -> ${optimalSize.width}x${optimalSize.height}`);
    }
}

    /* ------------------ Styling ------------------ */

    private blockTypeStyles: Record<BlockType, {
        baseWidth: number,
        color: string,
        boldMultiplier: number,
        italicMultiplier: number
    }> = {
            paragraph: {
                baseWidth: 2 * this.widthMultiplier,
                color: this.resolveCanvasColor('var(--text-normal)'),
                boldMultiplier: 1.5,
                italicMultiplier: 0.8
            },
            heading1: {
                baseWidth: 5 * this.widthMultiplier,
                color: this.resolveCanvasColor('var(--text-accent)'),
                boldMultiplier: 2.0,
                italicMultiplier: 0.8
            },
            heading2: {
                baseWidth: 4 * this.widthMultiplier,
                color: this.resolveCanvasColor('var(--text-accent)'),
                boldMultiplier: 2.0,
                italicMultiplier: 0.8
            },
            heading3: {
                baseWidth: 3.5 * this.widthMultiplier,
                color: this.resolveCanvasColor('var(--text-accent)'),
                boldMultiplier: 2.0,
                italicMultiplier: 0.8
            },
            heading4: {
                baseWidth: 3 * this.widthMultiplier,
                color: this.resolveCanvasColor('var(--text-accent)'),
                boldMultiplier: 2.0,
                italicMultiplier: 0.8
            },
            heading5: {
                baseWidth: 2.5 * this.widthMultiplier,
                color: this.resolveCanvasColor('var(--text-accent)'),
                boldMultiplier: 2.0,
                italicMultiplier: 0.8
            },
            quote: {
                baseWidth: 2 * this.widthMultiplier,
                color: this.resolveCanvasColor('var(--text-muted)'),
                boldMultiplier: 1.3,
                italicMultiplier: 0.8
            },
            math: {
                baseWidth: 2.5 * this.widthMultiplier,
                color: this.resolveCanvasColor('var(--text-accent-hover)'),
                boldMultiplier: 1.5,
                italicMultiplier: 0.8
            },
            drawing: {
                baseWidth: 2 * this.widthMultiplier,
                color: '',
                boldMultiplier: 1.0,
                italicMultiplier: 1.0
            },
            table: {
                baseWidth: 2 * this.widthMultiplier,
                color: this.resolveCanvasColor('var(--text-normal)'),
                boldMultiplier: 1.5,
                italicMultiplier: 0.8
            }
        };

    private getCalculatedStrokeStyle(blockType: BlockType, originalStyle: StrokeStyle): StrokeStyle {
        const isDrawing = blockType === 'drawing';

        // Für Drawing-Blöcke: Originalstil verwenden
        if (isDrawing) {
            return {
                ...originalStyle,
                color: this.resolveCanvasColor(originalStyle.color)
            };
        }

        // Hole die Basisbreite für diesen Blocktyp
        let baseWidth: number;
        switch (blockType) {
            case 'paragraph': baseWidth = 2.0; break;
            case 'heading1': baseWidth = 5.0; break;
            case 'heading2': baseWidth = 4.0; break;
            case 'heading3': baseWidth = 3.5; break;
            case 'heading4': baseWidth = 3.0; break;
            case 'heading5': baseWidth = 2.5; break;
            case 'quote': baseWidth = 2.0; break;
            case 'math': baseWidth = 2.5; break;
            case 'table': baseWidth = 2.0; break;
            default: baseWidth = 2.0; break;
        }

        // Multiplikator anwenden
        baseWidth *= this.widthMultiplier;

        const style: StrokeStyle = {
            width: baseWidth,
            color: this.useColorForStyling
                ? this.resolveCanvasColor(originalStyle.color)
                : this.getThemeAdaptiveColor('#000000'),
            semantic: originalStyle.semantic,
            opacity: 1.0
        };

        // Formatierung anwenden
        if (originalStyle.semantic === 'bold') {
            style.width *= 1.5;
        } else if (originalStyle.semantic === 'italic') {
            style.width *= 0.9;
        }

        return style;
    }

    private getThemeAdaptiveColor(defaultColor: string): string {
        const isDarkTheme = this.isDarkTheme();

        return isDarkTheme ? '#ffffff' : '#000000';
    }

    private updateThemeColors(): void {
        const isDark = this.isDarkTheme();
        console.log('Theme changed. Is dark:', isDark);

        // Aktualisiere alle Blöcke
        this.redrawAllBlocks();
    }

    private setupThemeObserver(): void {
        // Einfacherer Observer ohne rekursive Aufrufe
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    // Kurze Verzögerung, um Endlosschleifen zu vermeiden
                    setTimeout(() => {
                        this.updateThemeBasedOnCurrent();
                    }, 100);
                }
            });
        });

        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });

        // Cleanup speichern
        (this as any)._themeObserver = observer;
    }

    private isDarkTheme(): boolean {
        return document.body.classList.contains('theme-dark');
    }

    private setupThemeSync(): void {
        // Initiale Theme-Anpassung
        this.updateThemeBasedOnCurrent();

        // Observer für Theme-Änderungen
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    this.updateThemeBasedOnCurrent();
                }
            });
        });

        observer.observe(document.body, { attributes: true });

        // Cleanup speichern
        (this as any)._themeObserver = observer;
    }

    private updateThemeBasedOnCurrent(): void {
        const isDark = this.isDarkTheme();

        // Aktualisiere die Canvas-Hintergründe
        if (this.blocksContainer) {
            const canvases = this.blocksContainer.querySelectorAll('canvas');
            canvases.forEach(canvas => {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    // Canvas leeren und mit aktuellem Theme-Hintergrund füllen
                    ctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    // Strokes neu zeichnen
                    const blockId = canvas.closest('.ink-block')?.getAttribute('data-block-id');
                    if (blockId) {
                        const block = this.blocks.find(b => b.id === blockId);
                        if (block) {
                            this.drawBlockStrokes(canvas, block);
                        }
                    }
                }
            });
        }
    }

    private resolveCanvasColor(color: string): string {
        if (!color) return '#000000';

        // CSS-Variable auflösen
        if (color.startsWith('var(')) {
            const varName = color.slice(4, -1).trim();
            const computed = getComputedStyle(document.body).getPropertyValue(varName);
            return computed.trim() || '#000000';
        }

        return color;
    }

    /* ------------------ Tools ------------------ */

    private setTool(tool: 'pen' | 'eraser' | 'selection'): void {
        this.currentTool = tool;

        // Stelle sicher, dass alle Zeichen- und Radier-Zustände zurückgesetzt werden
        if (tool !== 'pen') {
            this.isDrawing = false;
            this.currentStroke = [];
        }
        if (tool !== 'eraser') {
            this.isErasing = false;
        }

        new Notice(`Tool set to: ${tool}`);
    }

    /* ------------------ Digitalization ------------------ */

    public async digitalizeCurrentDocument(): Promise<void> {
        try {
            if (!this.document || !this.file) {
                new Notice('No document to digitalize');
                return;
            }

            // Create markdown content from blocks
            let markdownContent = '';

            for (const block of this.blocks.sort((a, b) => a.order - b.order)) {
                const blockContent = this.digitalizeBlock(block);
                if (blockContent) {
                    markdownContent += blockContent + '\n\n';
                }
            }

            // Create comment with reference to .ink file
            const inkFilePath = this.file.path;
            const startComment = `%% VectorInk: ${inkFilePath} start %%`;
            const endComment = `%% VectorInk: ${inkFilePath} end %%`;

            const fullContent = `${startComment}\n\n${markdownContent}\n${endComment}`;

            // Create or update markdown file
            const mdFileName = this.file.basename + '.md';
            const mdFilePath = this.file.path.replace(/\.ink$/, '.md');

            try {
                // Use the vault adapter to check if file exists
                const adapter = (this.app.vault as unknown as { adapter: any }).adapter;
                const exists = await adapter.exists(mdFilePath);

                if (exists) {
                    // Read existing file
                    const existingContent = await adapter.read(mdFilePath);

                    // Find and replace the VectorInk section
                    const regex = new RegExp(`%% VectorInk: ${inkFilePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} start %%.*?%% VectorInk: ${inkFilePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} end %%`, 's');

                    if (regex.test(existingContent)) {
                        const newContent = existingContent.replace(regex, fullContent);
                        await adapter.write(mdFilePath, newContent);
                    } else {
                        await adapter.write(mdFilePath, existingContent + '\n\n' + fullContent);
                    }
                } else {
                    // Create new file
                    await adapter.write(mdFilePath, fullContent);
                }

                new Notice(`Digitalized to: ${mdFileName}`);

            } catch (error) {
                console.error('Error creating/updating markdown file:', error);
                new Notice('Error digitalizing document');
            }

        } catch (error) {
            console.error('Digitalization error:', error);
            new Notice('Failed to digitalize document');
        }
    }

    private digitalizeBlock(block: Block): string {
        if (!this.document) return '';

        // Get strokes for this block
        const strokes = block.strokeIds
            .map(id => this.document!.getStroke(id))
            .filter((s): s is Stroke => s !== undefined);

        if (strokes.length === 0) return '';

        // This is where you would integrate handwriting recognition
        // For now, we'll create placeholder text based on block type

        let content = '';
        const strokeCount = strokes.length;

        switch (block.type) {
            case 'paragraph':
                content = `Paragraph with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'heading1':
                content = `# Heading with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'heading2':
                content = `## Heading with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'heading3':
                content = `### Heading with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'heading4':
                content = `#### Heading with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'heading5':
                content = `##### Heading with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'math':
                content = `$$ Math content with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}. $$`;
                break;
            case 'quote':
                content = `> Quote with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'drawing':
                content = `![Drawing with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}](${this.file?.basename}.ink)`;
                break;
            case 'table':
                content = `| Table | Content |\n|-------|---------|\n| Strokes | ${strokeCount} |`;
                break;
        }

        // Apply formatting based on stroke semantics
        const hasBold = strokes.some(s => s.style.semantic === 'bold');
        const hasItalic = strokes.some(s => s.style.semantic === 'italic');

        if (hasBold && hasItalic) {
            content = `***${content}***`;
        } else if (hasBold) {
            content = `**${content}**`;
        } else if (hasItalic) {
            content = `*${content}*`;
        }

        return content;
    }

    /* ------------------ Persistence ------------------ */

    async loadDocument(): Promise<void> {
        if (!this.file) {
            this.document = new InkDocument();
            return;
        }

        try {
            const raw = await this.app.vault.read(this.file);
            this.document = raw ? new InkDocument(JSON.parse(raw)) : new InkDocument();

            // Load blocks from document
            if (this.document) {
                this.blocks = [...this.document.blocks].sort((a, b) => a.order - b.order);
            }
        } catch {
            this.document = new InkDocument();
        }
    }

    async onLoadFile(file: TFile): Promise<void> {
        console.log('🔄 Loading file:', file.path);

        // Datei wechseln
        this.file = file;

        // UI zurücksetzen
        this.contentEl.empty();
        this.document = null;
        this.blocks = [];
        this.currentBlockIndex = 0;

        // Neues Dokument laden
        await this.loadDocument();

        // UI neu aufbauen
        await this.setupUI();

        // Scroll positionieren
        if (this.blocksContainer) {
            this.blocksContainer.scrollTop = 0;
        }
    }

    // Korrigierte saveDocument-Methode:
    async saveDocument(): Promise<void> {
        if (!this.document || !this.file) {
            console.error('❌ No document or file to save');
            new Notice('No document to save');
            return;
        }

        try {
            console.log('💾 Saving document...');

            // Dokument-Daten vorbereiten
            const docData = this.document.getData();

            // Blöcke ins Dokument übertragen
            docData.blocks = this.blocks.map(block => ({
                ...block,
                // Sicherstellen, dass strokeIds aktuell sind
                strokeIds: [...block.strokeIds]
            })).sort((a, b) => a.order - b.order);

            // Strokes filtern: Nur Strokes behalten, die in Blöcken referenziert sind
            const usedStrokeIds = new Set<string>();
            docData.blocks.forEach(block => {
                block.strokeIds.forEach(id => usedStrokeIds.add(id));
            });

            docData.strokes = docData.strokes.filter(stroke =>
                usedStrokeIds.has(stroke.id)
            );

            // Aktualisierte Daten zurück ins Dokument
            this.document = new InkDocument(docData);

            // In Datei speichern
            await this.app.vault.modify(this.file, JSON.stringify(docData, null, 2));

            console.log('✅ Document saved successfully');
            new Notice('Document saved');

        } catch (error) {
            console.error('❌ Failed to save document:', error);
            new Notice(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private updateBlock(updates: PartialBlock): void {
        const index = this.blocks.findIndex(b => b.id === updates.id);
        if (index >= 0) {
            const block = this.blocks[index];
            if (block) {
                // Block aktualisieren
                Object.assign(block, updates);

                // Im Dokument aktualisieren (wenn Dokument existiert)
                if (this.document) {
                    const docBlock = this.document.getBlock(block.id);
                    if (docBlock) {
                        // Dokument-Block aktualisieren
                        this.document.updateBlock(block.id, block);
                    } else {
                        // Neuen Block zum Dokument hinzufügen
                        this.document.addBlock(block);
                    }
                }
            }
        }
    }

    private setupEventListeners(): void {
        // Global keyboard shortcuts
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle if we're focused on the view
            if (!this.contentEl.contains(document.activeElement)) return;

            switch (e.key) {
                case 'Escape':
                    this.setTool('selection');
                    break;
                case 'p':
                case 'P':
                    if (e.ctrlKey) {
                        this.setTool('pen');
                        e.preventDefault();
                    }
                    break;
                case 'e':
                case 'E':
                    if (e.ctrlKey) {
                        this.setTool('eraser');
                        e.preventDefault();
                    }
                    break;
                case 's':
                case 'S':
                    if (e.ctrlKey) {
                        this.saveDocument();
                        e.preventDefault();
                    }
                    break;
                case 'd':
                case 'D':
                    if (e.ctrlKey) {
                        this.digitalizeCurrentDocument();
                        e.preventDefault();
                    }
                    break;
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        window.addEventListener('resize', () => {
            if (!this.blocksContainer) return;
            this.blocks.forEach(block => {
                const canvas = this.getCanvasForBlock(block.id);
                if (canvas) this.updateBlockCanvasSize(block, canvas);
            });
        });


        // Store reference for cleanup
        (this as any)._handleKeyDown = handleKeyDown;
    }

    onunload(): void {
        // Cleanup event listeners
        const handleKeyDown = (this as any)._handleKeyDown;
        if (handleKeyDown) {
            document.removeEventListener('keydown', handleKeyDown);
        }
    }
}