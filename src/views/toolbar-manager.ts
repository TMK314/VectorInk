import { Block, BlockDisplaySettings, BlockType, StrokeStyle } from '../types';
import { InkView } from './InkView';
import { Notice } from 'obsidian';

export class ToolbarManager {
    private context: InkView;

    public toolbar: HTMLElement | null = null;
    public epsilonInput: HTMLInputElement | null = null;
    public marginTopInput: HTMLInputElement | null = null;
    public marginBottomInput: HTMLInputElement | null = null;
    public blockMargins: { top: number; bottom: number } = { top: 8, bottom: 8 };
    public useColorForStyling = true;

    // Grid controls
    private gridContainer: HTMLElement | null = null;
    private gridEnabledCheckbox: HTMLInputElement | null = null;
    private gridTypeSelect: HTMLSelectElement | null = null;
    private gridSizeInput: HTMLInputElement | null = null;
    private gridOpacityInput: HTMLInputElement | null = null;

    // Block display controls (updated on block switch via syncToolbarToCurrentBlock)
    private colorToggle: HTMLInputElement | null = null;
    private bgColorInput: HTMLInputElement | null = null;
    private widthMultiplierInput: HTMLInputElement | null = null;
    private multiplierValue: HTMLSpanElement | null = null;

    constructor(context: InkView) {
        this.context = context;
    }

    public createToolbar(container: HTMLElement): void {
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'ink-toolbar';
        this.toolbar.style.display = 'flex';
        this.toolbar.style.gap = '10px';
        this.toolbar.style.padding = '10px';
        this.toolbar.style.borderBottom = '1px solid var(--background-modifier-border)';
        this.toolbar.style.flexWrap = 'wrap';
        this.toolbar.style.alignItems = 'center';
        this.toolbar.style.background = 'var(--background-primary)';

        // Save button
        const saveBtn = this.createToolbarButton('💾', 'Save', () => this.context.saveDocument());
        this.toolbar.appendChild(saveBtn);

        // Tools section
        this.toolbar.appendChild(this.createSeparator());
        this.toolbar.appendChild(this.createToolbarButton('✏️', 'Pen', () => {
            this.context.drawingManager.setTool('pen');
        }));
        this.toolbar.appendChild(this.createToolbarButton('🧽', 'Eraser', () => {
            this.context.drawingManager.setTool('eraser');
        }));
        this.toolbar.appendChild(this.createToolbarButton('↖️', 'Select', () => {
            this.context.drawingManager.setTool('selection');
        }));

        // Grid controls section
        this.toolbar.appendChild(this.createSeparator());
        this.createGridControls();

        // Stroke manipulation section
        this.toolbar.appendChild(this.createSeparator());

        const strokeTools = document.createElement('div');
        strokeTools.style.display = 'flex';
        strokeTools.style.gap = '5px';
        strokeTools.style.alignItems = 'center';

        const strokeLabel = document.createElement('span');
        strokeLabel.textContent = 'Stroke Tools:';
        strokeLabel.style.fontSize = '12px';
        strokeTools.appendChild(strokeLabel);

        // Copy button
        const copyBtn = this.createToolbarButton('⎘ Copy', 'Copy selected strokes (Ctrl+C)', () => {
            this.context.strokeSelectionManager.copySelectedStrokes();
        });
        strokeTools.appendChild(copyBtn);

        // Paste button
        const pasteBtn = this.createToolbarButton('⎙ Paste', 'Paste strokes (Ctrl+V)', () => {
            this.context.strokeSelectionManager.pasteStrokes(this.context.currentBlockIndex);
        });
        strokeTools.appendChild(pasteBtn);

        // Delete button
        const deleteBtn = this.createToolbarButton('🗑 Delete', 'Delete selected strokes (Delete)', () => {
            this.context.strokeSelectionManager.deleteSelectedStrokes();
        });
        strokeTools.appendChild(deleteBtn);

        // Anhängen der Stroke-Tools an die Toolbar
        this.toolbar.appendChild(strokeTools);

        // Style tools section
        this.toolbar.appendChild(this.createSeparator());

        const styleTools = document.createElement('div');
        styleTools.style.display = 'flex';
        styleTools.style.gap = '5px';
        styleTools.style.alignItems = 'center';
        styleTools.style.flexWrap = 'wrap';

        const styleLabel = document.createElement('span');
        styleLabel.textContent = 'Style:';
        styleLabel.style.fontSize = '12px';
        styleTools.appendChild(styleLabel);

        // Color picker for selected strokes
        const strokeColorLabel = document.createElement('span');
        strokeColorLabel.textContent = 'Color:';
        strokeColorLabel.style.fontSize = '12px';
        styleTools.appendChild(strokeColorLabel);

        const strokeColorInput = document.createElement('input');
        strokeColorInput.type = 'color';
        strokeColorInput.value = '#000000';
        strokeColorInput.style.width = '30px';
        strokeColorInput.style.height = '30px';
        strokeColorInput.style.cursor = 'pointer';
        strokeColorInput.style.verticalAlign = 'middle';
        strokeColorInput.onchange = (e) => {
            const color = (e.target as HTMLInputElement).value;
            if (this.context.strokeSelectionManager.selectedStrokes.size > 0) {
                this.context.strokeSelectionManager.applyStyleToSelectedStrokes({ color });
            } else {
                this.context.drawingManager.currentPenStyle.color = color;
                this.context.styleManager.updateThemeColors();
            }
        };
        styleTools.appendChild(strokeColorInput);

        // Opacity for selected strokes
        const strokeOpacityLabel = document.createElement('span');
        strokeOpacityLabel.textContent = 'Opacity:';
        strokeOpacityLabel.style.fontSize = '12px';
        styleTools.appendChild(strokeOpacityLabel);

        const strokeOpacityInput = document.createElement('input');
        strokeOpacityInput.type = 'range';
        strokeOpacityInput.min = '0';
        strokeOpacityInput.max = '100';
        strokeOpacityInput.value = '100';
        strokeOpacityInput.style.width = '60px';
        strokeOpacityInput.style.verticalAlign = 'middle';
        strokeOpacityInput.onchange = (e) => {
            const opacity = parseInt((e.target as HTMLInputElement).value) / 100;
            if (this.context.strokeSelectionManager.selectedStrokes.size > 0) {
                this.context.strokeSelectionManager.applyStyleToSelectedStrokes({ opacity });
            } else {
                this.context.drawingManager.currentPenStyle.opacity = opacity;
            }
        };
        styleTools.appendChild(strokeOpacityInput);

        // Width for selected strokes
        const strokeWidthLabel = document.createElement('span');
        strokeWidthLabel.textContent = 'Width:';
        strokeWidthLabel.style.fontSize = '12px';
        styleTools.appendChild(strokeWidthLabel);

        const strokeWidthInput = document.createElement('input');
        strokeWidthInput.type = 'range';
        strokeWidthInput.min = '1';
        strokeWidthInput.max = '20';
        strokeWidthInput.value = '2';
        strokeWidthInput.style.width = '60px';
        strokeWidthInput.style.verticalAlign = 'middle';
        strokeWidthInput.onchange = (e) => {
            const width = parseInt((e.target as HTMLInputElement).value);
            if (this.context.strokeSelectionManager.selectedStrokes.size > 0) {
                this.context.strokeSelectionManager.applyStyleToSelectedStrokes({ width });
            } else {
                this.context.drawingManager.currentPenStyle.width = width;
            }
        };
        styleTools.appendChild(strokeWidthInput);

        // Formatting buttons for selected strokes
        const formatContainer = document.createElement('div');
        formatContainer.style.display = 'flex';
        formatContainer.style.gap = '5px';
        formatContainer.style.alignItems = 'center';

        const formatLabel = document.createElement('span');
        formatLabel.textContent = 'Format:';
        formatLabel.style.fontSize = '12px';
        formatContainer.appendChild(formatLabel);

        const normalBtn = this.createFormatButton('Normal', 'normal', () => {
            if (this.context.strokeSelectionManager.selectedStrokes.size > 0) {
                this.context.strokeSelectionManager.applyStyleToSelectedStrokes({
                    semantic: 'normal'
                });
            } else {
                this.context.drawingManager.currentPenStyle.semantic = 'normal';
            }
        });
        formatContainer.appendChild(normalBtn);

        const boldBtn = this.createFormatButton('B', 'bold', () => {
            if (this.context.strokeSelectionManager.selectedStrokes.size > 0) {
                this.context.strokeSelectionManager.applyStyleToSelectedStrokes({
                    semantic: 'bold'
                });
            } else {
                this.context.drawingManager.currentPenStyle.semantic = 'bold';
            }
        });
        formatContainer.appendChild(boldBtn);

        const italicBtn = this.createFormatButton('I', 'italic', () => {
            if (this.context.strokeSelectionManager.selectedStrokes.size > 0) {
                this.context.strokeSelectionManager.applyStyleToSelectedStrokes({
                    semantic: 'italic'
                });
            } else {
                this.context.drawingManager.currentPenStyle.semantic = 'italic';
            }
        });
        formatContainer.appendChild(italicBtn);

        // Anhängen der Style-Tools und Formatierung
        this.toolbar.appendChild(styleTools);
        this.toolbar.appendChild(formatContainer);

        // Color Toggle (für Block-Farbstyling)
        this.toolbar.appendChild(this.createSeparator());

        const colorToggleContainer = document.createElement('div');
        colorToggleContainer.style.display = 'flex';
        colorToggleContainer.style.alignItems = 'center';
        colorToggleContainer.style.gap = '5px';

        const colorToggleLabel = document.createElement('span');
        colorToggleLabel.textContent = 'Use Color:';
        colorToggleLabel.style.fontSize = '12px';
        colorToggleContainer.appendChild(colorToggleLabel);

        this.colorToggle = document.createElement('input');
        this.colorToggle.type = 'checkbox';
        this.useColorForStyling = this.getCurrentBlock()?.displaySettings?.useColor ?? true;
        this.colorToggle.checked = this.useColorForStyling;
        this.colorToggle.style.transform = 'scale(0.9)';
        this.colorToggle.style.verticalAlign = 'middle';
        this.colorToggle.onchange = () => {
            this.useColorForStyling = this.colorToggle!.checked;
            this.applyToSelectedBlocks(block => {
                this.ensureBlockDisplaySettings(block).useColor = this.useColorForStyling;
            });
            // BG-Picker ist nur relevant wenn useColor=true
            if (this.bgColorInput) this.bgColorInput.disabled = !this.useColorForStyling;
            new Notice(this.useColorForStyling ? 'Using color for styling' : 'Using block-based styling');
            this.context.drawingManager.redrawAllBlocks();
        };
        colorToggleContainer.appendChild(this.colorToggle);

        this.toolbar.appendChild(colorToggleContainer);

        // Hintergrundfarbe (pro Block, nur wirksam wenn useColor=false)
        const bgColorLabel = document.createElement('span');
        bgColorLabel.textContent = 'BG:';
        bgColorLabel.style.fontSize = '12px';
        this.toolbar.appendChild(bgColorLabel);

        this.bgColorInput = document.createElement('input');
        this.bgColorInput.type = 'color';
        this.bgColorInput.value = this.getCurrentBlock()?.displaySettings?.backgroundColor ?? '#ffffff';
        this.bgColorInput.title = 'Hintergrundfarbe (nur bei Use Color = aus)';
        this.bgColorInput.style.width = '30px';
        this.bgColorInput.style.height = '22px';
        this.bgColorInput.style.cursor = 'pointer';
        this.bgColorInput.style.verticalAlign = 'middle';
        this.bgColorInput.disabled = this.useColorForStyling;
        this.bgColorInput.oninput = () => {
            this.applyToSelectedBlocks(block => {
                this.ensureBlockDisplaySettings(block).backgroundColor = this.bgColorInput!.value;
            });
            this.context.drawingManager.redrawAllBlocks();
        };
        this.toolbar.appendChild(this.bgColorInput);

        // Width multiplier
        this.toolbar.appendChild(this.createSeparator());

        const multiplierLabel = document.createElement('span');
        multiplierLabel.textContent = 'Zoom:';
        multiplierLabel.style.fontSize = '12px';
        this.toolbar.appendChild(multiplierLabel);

        this.widthMultiplierInput = document.createElement('input');
        this.widthMultiplierInput.type = 'range';
        this.widthMultiplierInput.min = '0.5';
        this.widthMultiplierInput.max = '4.0';
        this.widthMultiplierInput.step = '0.1';
        this.widthMultiplierInput.value = '1';
        this.widthMultiplierInput.style.width = '60px';
        this.widthMultiplierInput.style.verticalAlign = 'middle';

        this.multiplierValue = document.createElement('span');
        this.multiplierValue.textContent = ` (${this.widthMultiplierInput.value}x)`;
        this.multiplierValue.style.fontSize = '12px';

        this.widthMultiplierInput.oninput = () => {
            const value = parseFloat(this.widthMultiplierInput!.value);
            this.context.drawingManager.widthMultiplier = value;
            const block = this.getCurrentBlock();
            if (block) this.ensureBlockDisplaySettings(block).widthMultiplier = value;
            this.multiplierValue!.textContent = ` (${value.toFixed(1)}x)`;
            this.context.drawingManager.redrawAllBlocks();
        };

        // onchange = oninput (redundant assignment removed)

        this.toolbar.appendChild(this.widthMultiplierInput);
        this.toolbar.appendChild(this.multiplierValue);

        // Epsilon setting
        this.toolbar.appendChild(this.createSeparator());
        const epsilonLabel = document.createElement('span');
        epsilonLabel.textContent = 'Epsilon:';
        epsilonLabel.style.fontSize = '12px';
        this.toolbar.appendChild(epsilonLabel);

        this.epsilonInput = document.createElement('input');
        this.epsilonInput.type = 'number';
        this.epsilonInput.value = '1.0';
        this.epsilonInput.step = '0.1';
        this.epsilonInput.min = '0.1';
        this.epsilonInput.max = '10';
        this.epsilonInput.style.width = '60px';
        this.epsilonInput.onchange = (e) => {
            this.context.drawingManager.epsilon = parseFloat((e.target as HTMLInputElement).value);
        };
        this.toolbar.appendChild(this.epsilonInput);

        // Margin settings
        this.toolbar.appendChild(this.createSeparator());
        const marginLabel = document.createElement('span');
        marginLabel.textContent = 'Margins:';
        marginLabel.style.fontSize = '12px';
        this.toolbar.appendChild(marginLabel);

        const marginContainer = document.createElement('div');
        marginContainer.style.display = 'flex';
        marginContainer.style.gap = '5px';

        const topLabel = document.createElement('span');
        topLabel.textContent = 'T:';
        marginContainer.appendChild(topLabel);

        this.marginTopInput = document.createElement('input');
        this.marginTopInput.type = 'number';
        this.marginTopInput.value = '8';
        this.marginTopInput.min = '0';
        this.marginTopInput.max = '50';
        this.marginTopInput.step = '1';
        this.marginTopInput.style.width = '50px';
        this.marginTopInput.onchange = (e) => {
            this.blockMargins.top = parseInt((e.target as HTMLInputElement).value);
            this.context.blockManager.updateBlockMargins();
        };
        marginContainer.appendChild(this.marginTopInput);

        const bottomLabel = document.createElement('span');
        bottomLabel.textContent = 'B:';
        marginContainer.appendChild(bottomLabel);

        this.marginBottomInput = document.createElement('input');
        this.marginBottomInput.type = 'number';
        this.marginBottomInput.value = '8';
        this.marginBottomInput.min = '0';
        this.marginBottomInput.max = '50';
        this.marginBottomInput.step = '1';
        this.marginBottomInput.style.width = '50px';
        this.marginBottomInput.onchange = (e) => {
            this.blockMargins.bottom = parseInt((e.target as HTMLInputElement).value);
            this.context.blockManager.updateBlockMargins();
        };
        marginContainer.appendChild(this.marginBottomInput);

        this.toolbar.appendChild(marginContainer);

        // Add block button
        this.toolbar.appendChild(this.createSeparator());
        const addBlockBtn = this.createToolbarButton('＋', 'Add Block', () => this.context.blockManager.addNewBlock('paragraph', this.context.blocks.length));
        this.toolbar.appendChild(addBlockBtn);

        container.appendChild(this.toolbar);
    }

    private createFormatButton(text: string, semantic: string, onClick: () => void): HTMLElement {
        const button = document.createElement('button');
        button.textContent = text;
        button.style.padding = '4px 8px';
        button.style.fontSize = '11px';
        button.style.border = '1px solid var(--background-modifier-border)';
        button.style.borderRadius = '4px';
        button.style.background = 'var(--interactive-normal)';
        button.style.cursor = 'pointer';
        button.style.color = 'var(--text-muted)';
        button.style.fontWeight = semantic === 'bold' ? 'bold' : 'normal';
        button.style.fontStyle = semantic === 'italic' ? 'italic' : 'normal';
        button.onclick = (e) => {
            e.stopPropagation();
            onClick();
        };

        button.onmouseenter = () => {
            button.style.background = 'var(--interactive-hover)';
            button.style.color = 'var(--text-normal)';
        };
        button.onmouseleave = () => {
            button.style.background = 'var(--interactive-normal)';
            button.style.color = 'var(--text-muted)';
        };

        return button;
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

    private createSeparator(): HTMLElement {
        const separator = document.createElement('div');
        separator.style.width = '1px';
        separator.style.height = '20px';
        separator.style.background = 'var(--background-modifier-border)';
        separator.style.margin = '0 5px';
        return separator;
    }

    public updateBlockMargins(): void {
        if (!this.context.blocksContainer) return;

        const blocks = this.context.blocksContainer.querySelectorAll<HTMLElement>('.ink-block');
        blocks.forEach((block: HTMLElement, index) => {
            const isSelected = index === this.context.currentBlockIndex;
            const marginTop = isSelected ?
                Math.max(this.blockMargins.top, 12) :
                this.blockMargins.top;
            const marginBottom = isSelected ?
                Math.max(this.blockMargins.bottom, 12) :
                this.blockMargins.bottom;

            block.style.marginTop = `${marginTop}px`;
            block.style.marginBottom = `${marginBottom}px`;
        });
    }

    private createGridControls(): void {
        this.gridContainer = document.createElement('div');
        this.gridContainer.style.display = 'flex';
        this.gridContainer.style.gap = '5px';
        this.gridContainer.style.alignItems = 'center';
        this.gridContainer.style.flexWrap = 'wrap';

        // Standard Grid-Einstellungen, falls document noch nicht geladen ist
        const defaultGridSettings = {
            enabled: false,
            type: 'grid' as 'grid' | 'lines' | 'dots',
            size: 20,
            color: '#e0e0e0',
            opacity: 0.5
        };

        // Grid-Einstellungen aus Dokument oder Standardwerte
        const gridSettings = this.context.document?.gridSettings || defaultGridSettings;

        // Grid toggle
        const gridToggleContainer = document.createElement('div');
        gridToggleContainer.style.display = 'flex';
        gridToggleContainer.style.alignItems = 'center';
        gridToggleContainer.style.gap = '3px';

        this.gridEnabledCheckbox = document.createElement('input');
        this.gridEnabledCheckbox.type = 'checkbox';
        this.gridEnabledCheckbox.title = 'Toggle grid';
        this.gridEnabledCheckbox.checked = gridSettings.enabled;

        const gridLabel = document.createElement('span');
        gridLabel.textContent = 'Grid';
        gridLabel.style.fontSize = '12px';
        gridLabel.style.cursor = 'pointer';
        gridLabel.onclick = () => {
            if (this.gridEnabledCheckbox) {
                this.gridEnabledCheckbox.checked = !this.gridEnabledCheckbox.checked;
                this.gridEnabledCheckbox.dispatchEvent(new Event('change'));
            }
        };

        gridToggleContainer.appendChild(this.gridEnabledCheckbox);
        gridToggleContainer.appendChild(gridLabel);
        this.gridContainer.appendChild(gridToggleContainer);

        // Grid type selector - nur anzeigen wenn Grid aktiviert ist
        const gridTypeContainer = document.createElement('div');
        gridTypeContainer.style.display = 'flex';
        gridTypeContainer.style.alignItems = 'center';
        gridTypeContainer.style.gap = '3px';
        gridTypeContainer.style.display = gridSettings.enabled ? 'flex' : 'none';

        const typeLabel = document.createElement('span');
        typeLabel.textContent = 'Type:';
        typeLabel.style.fontSize = '11px';
        typeLabel.style.opacity = '0.8';
        gridTypeContainer.appendChild(typeLabel);

        this.gridTypeSelect = document.createElement('select');
        this.gridTypeSelect.style.fontSize = '11px';
        this.gridTypeSelect.style.padding = '2px';
        this.gridTypeSelect.style.background = 'var(--background-primary)';
        this.gridTypeSelect.style.color = 'var(--text-normal)';
        this.gridTypeSelect.style.border = '1px solid var(--background-modifier-border)';
        this.gridTypeSelect.style.borderRadius = '3px';

        const gridTypes = [
            { value: 'grid', label: 'Grid' },
            { value: 'lines', label: 'Lines' },
            { value: 'dots', label: 'Dots' }
        ];

        gridTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type.value;
            option.textContent = type.label;
            if (gridSettings.type === type.value) {
                option.selected = true;
            }
            if (this.gridTypeSelect)
                this.gridTypeSelect.appendChild(option);
        });

        this.gridTypeSelect.onchange = (e) => {
            const type = (e.target as HTMLSelectElement).value as 'grid' | 'lines' | 'dots';
            this.applyToSelectedBlocks(block => {
                const ds = this.ensureBlockDisplaySettings(block);
                ds.grid = { ...ds.grid, type };
            });
            if (this.context.document) this.context.document.setGridSettings({ type });
            this.context.drawingManager.redrawAllBlocks();
        };

        gridTypeContainer.appendChild(this.gridTypeSelect);
        this.gridContainer.appendChild(gridTypeContainer);

        // Grid size - nur anzeigen wenn Grid aktiviert ist
        const gridSizeContainer = document.createElement('div');
        gridSizeContainer.style.display = 'flex';
        gridSizeContainer.style.alignItems = 'center';
        gridSizeContainer.style.gap = '3px';
        gridSizeContainer.style.display = gridSettings.enabled ? 'flex' : 'none';

        const sizeLabel = document.createElement('span');
        sizeLabel.textContent = 'Size:';
        sizeLabel.style.fontSize = '11px';
        sizeLabel.style.opacity = '0.8';
        gridSizeContainer.appendChild(sizeLabel);

        this.gridSizeInput = document.createElement('input');
        this.gridSizeInput.type = 'number';
        this.gridSizeInput.min = '5';
        this.gridSizeInput.max = '100';
        this.gridSizeInput.step = '5';
        this.gridSizeInput.value = gridSettings.size.toString();
        this.gridSizeInput.style.width = '45px';
        this.gridSizeInput.style.fontSize = '11px';
        this.gridSizeInput.style.padding = '2px';
        this.gridSizeInput.style.border = '1px solid var(--background-modifier-border)';
        this.gridSizeInput.style.borderRadius = '3px';
        this.gridSizeInput.onchange = (e) => {
            const size = parseInt((e.target as HTMLInputElement).value);
            this.applyToSelectedBlocks(block => {
                const ds = this.ensureBlockDisplaySettings(block);
                ds.grid = { ...ds.grid, size };
            });
            if (this.context.document) this.context.document.setGridSettings({ size });
            this.context.drawingManager.redrawAllBlocks();
        };

        gridSizeContainer.appendChild(this.gridSizeInput);
        this.gridContainer.appendChild(gridSizeContainer);

        // Grid opacity - nur anzeigen wenn Grid aktiviert ist
        const gridOpacityContainer = document.createElement('div');
        gridOpacityContainer.style.display = 'flex';
        gridOpacityContainer.style.alignItems = 'center';
        gridOpacityContainer.style.gap = '3px';
        gridOpacityContainer.style.display = gridSettings.enabled ? 'flex' : 'none';

        const opacityLabel = document.createElement('span');
        opacityLabel.textContent = 'Opacity:';
        opacityLabel.style.fontSize = '11px';
        opacityLabel.style.opacity = '0.8';
        gridOpacityContainer.appendChild(opacityLabel);

        this.gridOpacityInput = document.createElement('input');
        this.gridOpacityInput.type = 'range';
        this.gridOpacityInput.min = '0';
        this.gridOpacityInput.max = '100';
        this.gridOpacityInput.value = (gridSettings.opacity * 100).toString();
        this.gridOpacityInput.style.width = '50px';
        this.gridOpacityInput.onchange = (e) => {
            const opacity = parseInt((e.target as HTMLInputElement).value) / 100;
            this.applyToSelectedBlocks(block => {
                const ds = this.ensureBlockDisplaySettings(block);
                ds.grid = { ...ds.grid, opacity };
            });
            if (this.context.document) this.context.document.setGridSettings({ opacity });
            this.context.drawingManager.redrawAllBlocks();
        };

        gridOpacityContainer.appendChild(this.gridOpacityInput);
        this.gridContainer.appendChild(gridOpacityContainer);

        // Einziger onchange-Handler: speichert Block-Settings, blendet Sub-Controls ein/aus, zeichnet neu
        this.gridEnabledCheckbox.onchange = (e) => {
            const enabled = (e.target as HTMLInputElement).checked;

            // Sub-Controls ein-/ausblenden
            if (gridTypeContainer) gridTypeContainer.style.display = enabled ? 'flex' : 'none';
            if (gridSizeContainer) gridSizeContainer.style.display = enabled ? 'flex' : 'none';
            if (gridOpacityContainer) gridOpacityContainer.style.display = enabled ? 'flex' : 'none';

            // Auf Block-Ebene speichern für alle ausgewählten Blöcke
            this.applyToSelectedBlocks(block => {
                const ds = this.ensureBlockDisplaySettings(block);
                ds.grid = { ...ds.grid, enabled };
            });
            // Auch Document-Level aktualisieren als Fallback für neue Blöcke
            if (this.context.document) this.context.document.setGridSettings({ enabled });

            this.context.drawingManager.redrawAllBlocks();
        };

        if (this.toolbar)
            this.toolbar.appendChild(this.gridContainer);
    }

    public updateGridControls(): void {
        if (!this.context.document) return;

        const block = this.getCurrentBlock();

        const grid = block?.displaySettings?.grid ?? this.context.document?.gridSettings;
        if (!grid) return;

        if (this.gridEnabledCheckbox) this.gridEnabledCheckbox.checked = grid.enabled;
        if (this.gridTypeSelect) this.gridTypeSelect.value = grid.type;
        if (this.gridSizeInput) this.gridSizeInput.value = grid.size.toString();
        if (this.gridOpacityInput) this.gridOpacityInput.value = (grid.opacity * 100).toString();

        // Andere Controls entsprechend ein/ausblenden
        const gridContainer = this.gridContainer;
        if (gridContainer) {
            const gridTypeContainer = gridContainer.querySelector('div:nth-child(2)') as HTMLElement;
            const gridSizeContainer = gridContainer.querySelector('div:nth-child(3)') as HTMLElement;
            const gridOpacityContainer = gridContainer.querySelector('div:nth-child(4)') as HTMLElement;

            if (gridTypeContainer) gridTypeContainer.style.display = grid.enabled ? 'flex' : 'none';
            if (gridSizeContainer) gridSizeContainer.style.display = grid.enabled ? 'flex' : 'none';
            if (gridOpacityContainer) gridOpacityContainer.style.display = grid.enabled ? 'flex' : 'none';
        }
    }

    private getCurrentBlock(): Block | undefined {
        return this.context.blocks[this.context.currentBlockIndex];
    }

    /**
     * Synchronisiert alle Toolbar-Controls mit dem aktuell ausgewählten Block.
     * Muss nach jedem Blockwechsel aufgerufen werden.
     */
    public syncToolbarToCurrentBlock(): void {
        const block = this.getCurrentBlock();
        const ds = block?.displaySettings;

        // Use Color
        const useColor = ds?.useColor ?? this.useColorForStyling;
        this.useColorForStyling = useColor;
        if (this.colorToggle) this.colorToggle.checked = useColor;
        if (this.bgColorInput) {
            this.bgColorInput.disabled = useColor;
            this.bgColorInput.value = ds?.backgroundColor ?? '#ffffff';
        }

        // Zoom / widthMultiplier
        const mult = ds?.widthMultiplier ?? this.context.drawingManager?.widthMultiplier ?? 1.0;
        if (this.widthMultiplierInput) this.widthMultiplierInput.value = String(mult);
        if (this.multiplierValue) this.multiplierValue.textContent = ` (${mult.toFixed(1)}x)`;

        // Grid
        this.updateGridControls();
    }

    /**
     * Wendet eine Funktion auf alle ausgewählten Blöcke an.
     * Falls keine Blöcke ausgewählt sind, wird nur der aktuelle Block verarbeitet.
     */
    private applyToSelectedBlocks(callback: (block: Block) => void): void {
        if (this.context.blockManager.selectedBlockIndices.size === 0) {
            const block = this.getCurrentBlock();
            if (block) callback(block);
        } else {
            this.context.blockManager.selectedBlockIndices.forEach(index => {
                const block = this.context.blocks[index];
                if (block) callback(block);
            });
        }
    }

    private ensureBlockDisplaySettings(block: Block): BlockDisplaySettings {
        if (!block.displaySettings) {
            block.displaySettings = {
                grid: {
                    ...(this.context.document?.gridSettings ?? {
                        enabled: false, type: 'grid' as const,
                        size: 20, color: '#e0e0e0', opacity: 0.5
                    })
                },
                useColor: this.useColorForStyling,
                widthMultiplier: this.context.drawingManager?.widthMultiplier ?? 1.0,
                backgroundColor: '#ffffff',
            };
        }
        return block.displaySettings;
    }
}