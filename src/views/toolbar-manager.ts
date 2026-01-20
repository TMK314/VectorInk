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

        const saveBtn = this.createToolbarButton('💾', 'Save', () => this.context.saveDocument());
        this.toolbar.appendChild(saveBtn);

        this.toolbar.appendChild(this.createSeparator());
        this.toolbar.appendChild(this.createToolbarButton('✏️', 'Pen', () => this.context.drawingManager.setTool('pen')));
        this.toolbar.appendChild(this.createToolbarButton('🧽', 'Eraser', () => this.context.drawingManager.setTool('eraser')));
        this.toolbar.appendChild(this.createToolbarButton('↖️', 'Select', () => this.context.drawingManager.setTool('selection')));

        this.toolbar.appendChild(this.createSeparator());

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

        this.toolbar.appendChild(this.createSeparator());

        // Tabellen-Linien-Tools (nur für Tabellenblöcke)
        this.toolbar.appendChild(this.createSeparator());
        
        const tableToolsContainer = document.createElement('div');
        tableToolsContainer.style.display = 'flex';
        tableToolsContainer.style.gap = '5px';
        tableToolsContainer.style.alignItems = 'center';
        
        const tableToolsLabel = document.createElement('span');
        tableToolsLabel.textContent = 'Table Lines:';
        tableToolsLabel.style.fontSize = '12px';
        tableToolsContainer.appendChild(tableToolsLabel);
        
        const addHorizontalBtn = this.createToolbarButton('─', 'Add horizontal line', () => this.addTableLine('horizontal'));
        const addVerticalBtn = this.createToolbarButton('│', 'Add vertical line', () => this.addTableLine('vertical'));
        const removeLineBtn = this.createToolbarButton('✕', 'Remove selected line', () => this.removeSelectedTableLine());
        
        tableToolsContainer.appendChild(addHorizontalBtn);
        tableToolsContainer.appendChild(addVerticalBtn);
        tableToolsContainer.appendChild(removeLineBtn);
        
        this.toolbar.appendChild(tableToolsContainer);

        // color toggle for styling

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

        this.toolbar.appendChild(this.createSeparator());
        const digitalizeBtn = this.createToolbarButton('⚡', 'Digitalize', () => this.context.digitalizationManager.digitalizeCurrentDocument());
        this.toolbar.appendChild(digitalizeBtn);

        const addBlockBtn = this.createToolbarButton('＋', 'Add Block', () => this.context.blockManager.addNewBlock('paragraph', this.context.blocks.length));
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

    private addTableLine(type: 'horizontal' | 'vertical'): void {
        const currentBlock = this.context.blocks[this.context.currentBlockIndex];
        if (!currentBlock || currentBlock.type !== 'table') {
            new Notice('Please select a table block first');
            return;
        }
        
        this.context.blockManager.addTableLine(currentBlock.id, type);
        new Notice(`Added ${type} table line`);
    }

    private removeSelectedTableLine(): void {
        const selectedLineId = this.context.blockManager.getSelectedLineId();
        if (!selectedLineId) {
            new Notice('No table line selected');
            return;
        }
        
        const currentBlock = this.context.blocks[this.context.currentBlockIndex];
        if (!currentBlock || currentBlock.type !== 'table') {
            new Notice('Please select a table block first');
            return;
        }
        
        this.context.blockManager.removeTableLine(currentBlock.id, selectedLineId);
        new Notice('Table line removed');
    }
}