import { BlockType, StrokeStyle } from '../types';
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
    
    // Tabellen-Tools
    private tableModeContainer: HTMLElement | null = null;
    private tableToolsContainer: HTMLElement | null = null;
    private tableModeIndicator: HTMLElement | null = null;
    private currentTableMode: 'vertical-line' | 'horizontal-line' | 'merge-cells' | null = null;

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
            this.setTableMode(null); // Tabellenmodus verlassen
        }));
        this.toolbar.appendChild(this.createToolbarButton('🧽', 'Eraser', () => {
            this.context.drawingManager.setTool('eraser');
            this.setTableMode(null); // Tabellenmodus verlassen
        }));
        this.toolbar.appendChild(this.createToolbarButton('↖️', 'Select', () => {
            this.context.drawingManager.setTool('selection');
            this.setTableMode(null); // Tabellenmodus verlassen
        }));

        // Pen settings
        this.toolbar.appendChild(this.createSeparator());

        // Color picker
        const colorLabel = document.createElement('span');
        colorLabel.textContent = 'Color:';
        colorLabel.style.fontSize = '12px';
        this.toolbar.appendChild(colorLabel);

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = this.context.styleManager.getThemeAdaptiveColor('#000000');
        colorInput.style.width = '30px';
        colorInput.style.height = '30px';
        colorInput.style.cursor = 'pointer';
        colorInput.style.verticalAlign = 'middle';
        colorInput.onchange = (e) => {
            const selectedColor = (e.target as HTMLInputElement).value;
            this.context.drawingManager.currentPenStyle.color = selectedColor;
            this.context.styleManager.updateThemeColors();
        };
        this.toolbar.appendChild(colorInput);

        // Opacity slider
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
            this.context.drawingManager.currentPenStyle.opacity = parseInt((e.target as HTMLInputElement).value) / 100;
        };
        this.toolbar.appendChild(opacityInput);

        // Width slider
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
            this.context.drawingManager.currentPenStyle.width = parseInt((e.target as HTMLInputElement).value);
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
            this.context.blockManager.renderBlocks();
            new Notice(this.useColorForStyling ? 'Using color for styling' : 'Using block-based styling');
        };
        colorToggleContainer.appendChild(colorToggle);

        this.toolbar.appendChild(colorToggleContainer);

        // Width multiplier
        const widthMultiplierInput = document.createElement('input');
        widthMultiplierInput.type = 'range';
        widthMultiplierInput.min = '0.5';
        widthMultiplierInput.max = '4.0';
        widthMultiplierInput.step = '0.1';
        widthMultiplierInput.value = '1';
        widthMultiplierInput.style.width = '60px';
        widthMultiplierInput.style.verticalAlign = 'middle';

        const multiplierValue = document.createElement('span');
        multiplierValue.textContent = ` (${widthMultiplierInput.value}x)`;
        multiplierValue.style.fontSize = '12px';

        widthMultiplierInput.oninput = (e) => {
            const value = parseFloat((e.target as HTMLInputElement).value);
            this.context.drawingManager.widthMultiplier = value;
            multiplierValue.textContent = ` (${value.toFixed(1)}x)`;
            this.context.drawingManager.redrawAllBlocks();
        };

        widthMultiplierInput.onchange = (e) => {
            const value = parseFloat((e.target as HTMLInputElement).value);
            this.context.drawingManager.widthMultiplier = value;
            multiplierValue.textContent = ` (${value.toFixed(1)}x)`;
            this.context.drawingManager.redrawAllBlocks();
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
            this.context.drawingManager.epsilon = parseFloat((e.target as HTMLInputElement).value);
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

        // Tabellen-Tools Section
        this.toolbar.appendChild(this.createSeparator());
        
        this.tableToolsContainer = document.createElement('div');
        this.tableToolsContainer.style.display = 'flex';
        this.tableToolsContainer.style.gap = '5px';
        this.tableToolsContainer.style.alignItems = 'center';
        this.tableToolsContainer.style.display = 'none'; // Initially hidden
        
        const tableToolsLabel = document.createElement('span');
        tableToolsLabel.textContent = 'Table Tools:';
        tableToolsLabel.style.fontSize = '12px';
        this.tableToolsContainer.appendChild(tableToolsLabel);
        
        // Tabellen-Tools Buttons
        const verticalLineBtn = this.createTableToolButton('│ Add Vert', 'Add vertical line', () => 
            this.setTableMode('vertical-line'));
        const horizontalLineBtn = this.createTableToolButton('─ Add Horiz', 'Add horizontal line', () => 
            this.setTableMode('horizontal-line'));
        const mergeCellsBtn = this.createTableToolButton('⬌ Merge', 'Merge cells', () => 
            this.setTableMode('merge-cells'));
        const exitTableModeBtn = this.createTableToolButton('✕ Exit', 'Exit table mode', () => 
            this.setTableMode(null));
        
        this.tableToolsContainer.appendChild(verticalLineBtn);
        this.tableToolsContainer.appendChild(horizontalLineBtn);
        this.tableToolsContainer.appendChild(mergeCellsBtn);
        this.tableToolsContainer.appendChild(exitTableModeBtn);
        
        // Table mode indicator
        this.tableModeIndicator = document.createElement('div');
        this.tableModeIndicator.style.display = 'none';
        this.tableModeIndicator.style.padding = '3px 8px';
        this.tableModeIndicator.style.fontSize = '11px';
        this.tableModeIndicator.style.background = 'var(--interactive-accent)';
        this.tableModeIndicator.style.color = 'var(--text-on-accent)';
        this.tableModeIndicator.style.borderRadius = '3px';
        this.tableModeIndicator.style.marginLeft = '10px';
        this.tableToolsContainer.appendChild(this.tableModeIndicator);
        
        this.toolbar.appendChild(this.tableToolsContainer);

        // Digitalize button
        this.toolbar.appendChild(this.createSeparator());
        const digitalizeBtn = this.createToolbarButton('⚡', 'Digitalize', () => this.context.digitalizationManager.digitalizeCurrentDocument());
        this.toolbar.appendChild(digitalizeBtn);

        // Add block button
        const addBlockBtn = this.createToolbarButton('＋', 'Add Block', () => this.context.blockManager.addNewBlock('paragraph', this.context.blocks.length));
        this.toolbar.appendChild(addBlockBtn);

        container.appendChild(this.toolbar);
    }

    private createTableToolButton(text: string, title: string, onClick: () => void): HTMLElement {
        const button = document.createElement('button');
        button.textContent = text;
        button.title = title;
        button.style.padding = '4px 8px';
        button.style.fontSize = '11px';
        button.style.border = '1px solid var(--background-modifier-border)';
        button.style.borderRadius = '4px';
        button.style.background = 'var(--interactive-normal)';
        button.style.cursor = 'pointer';
        button.style.color = 'var(--text-muted)';
        button.onclick = (e) => {
            e.stopPropagation();
            onClick();
        };
        
        button.onmouseenter = () => {
            button.style.background = 'var(--interactive-hover)';
            button.style.color = 'var(--text-normal)';
        };
        button.onmouseleave = () => {
            if (this.currentTableMode !== this.getModeFromButtonText(text)) {
                button.style.background = 'var(--interactive-normal)';
                button.style.color = 'var(--text-muted)';
            }
        };
        
        return button;
    }

    private getModeFromButtonText(text: string): 'vertical-line' | 'horizontal-line' | 'merge-cells' | null {
        if (text.includes('Vert')) return 'vertical-line';
        if (text.includes('Horiz')) return 'horizontal-line';
        if (text.includes('Merge')) return 'merge-cells';
        return null;
    }

    public setTableMode(mode: 'vertical-line' | 'horizontal-line' | 'merge-cells' | null): void {
        const currentBlock = this.context.blocks[this.context.currentBlockIndex];
        if (!currentBlock || currentBlock.type !== 'table') {
            if (mode) {
                new Notice('Please select a table block first');
                return;
            }
        }

        this.currentTableMode = mode;
        
        // Aktualisiere Button-Styles
        if (this.tableToolsContainer) {
            const buttons = this.tableToolsContainer.querySelectorAll('button');
            buttons.forEach(btn => {
                const btnMode = this.getModeFromButtonText(btn.textContent || '');
                if (btnMode === mode && mode !== null) {
                    btn.style.background = 'var(--interactive-accent)';
                    btn.style.color = 'var(--text-on-accent)';
                    btn.style.borderColor = 'var(--interactive-accent)';
                } else {
                    btn.style.background = 'var(--interactive-normal)';
                    btn.style.color = 'var(--text-muted)';
                    btn.style.borderColor = 'var(--background-modifier-border)';
                }
            });
        }
        
        // Aktualisiere Indicator
        if (this.tableModeIndicator) {
            if (mode) {
                let modeText = '';
                switch (mode) {
                    case 'vertical-line': modeText = 'Adding Vertical Lines'; break;
                    case 'horizontal-line': modeText = 'Adding Horizontal Lines'; break;
                    case 'merge-cells': modeText = 'Merging Cells'; break;
                }
                this.tableModeIndicator.textContent = modeText;
                this.tableModeIndicator.style.display = 'block';
            } else {
                this.tableModeIndicator.style.display = 'none';
            }
        }
        
        // Benachrichtigung
        if (mode === 'vertical-line') {
            new Notice('Vertical line mode: Click to add lines, drag to move, select and press Delete to remove');
        } else if (mode === 'horizontal-line') {
            new Notice('Horizontal line mode: Click to add lines, drag to move, select and press Delete to remove');
        } else if (mode === 'merge-cells') {
            new Notice('Merge mode: Click two cells to merge them');
        } else {
            new Notice('Exited table edit mode');
        }
        
        // Render blocks neu für visuelles Feedback
        this.context.blockManager.renderBlocks();
    }

    public getCurrentTableMode(): 'vertical-line' | 'horizontal-line' | 'merge-cells' | null {
        return this.currentTableMode;
    }

    public updateTableToolsVisibility(): void {
        const currentBlock = this.context.blocks[this.context.currentBlockIndex];
        const isTableBlock = currentBlock && currentBlock.type === 'table';
        
        if (this.tableToolsContainer) {
            this.tableToolsContainer.style.display = isTableBlock ? 'flex' : 'none';
        }
        
        // Wenn kein Tabellenblock mehr ausgewählt ist, Tabellenmodus verlassen
        if (!isTableBlock && this.currentTableMode) {
            this.setTableMode(null);
        }
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
            this.context.drawingManager.currentPenStyle.semantic = semantic as any;
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

    public updateBlockMargins(): void {
        if (!this.context.blocksContainer) return;

        const blocks = this.context.blocksContainer.querySelectorAll('.ink-block');
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
}