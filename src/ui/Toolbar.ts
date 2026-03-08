// ui/Toolbar.ts
import { InkView } from '../views/InkView';
import { StrokeStyle } from '../types';

export class Toolbar {
    private container: HTMLElement;
    private view: InkView;
    private toolbarEl: HTMLElement = document.createElement('div'); private currentBlockType: string = 'paragraph';

    constructor(container: HTMLElement, view: InkView) {
        this.container = container;
        this.view = view;
        this.createToolbar();
    }

    private createToolbar(): void {
        // Use document.createElement instead of createDiv
        this.toolbarEl = document.createElement('div');
        this.toolbarEl.className = 'ink-toolbar';
        this.container.appendChild(this.toolbarEl);

        // Pen tools
        this.addPenTool('Normal', '#000000', 'normal');
        this.addPenTool('Bold', '#000000', 'bold');
        this.addPenTool('Highlight', '#fbbf24', 'highlight');

        // Block types
        this.addBlockTypeButton('Paragraph', 'paragraph');
        this.addBlockTypeButton('Heading', 'heading');
        this.addBlockTypeButton('Math', 'math');
        this.addBlockTypeButton('Quote', 'quote');

        // Actions
        this.addActionButton('Clear', '🗑️', () => this.clearCanvas());
        this.addActionButton('Save', '💾', () => this.view.saveDocument());
    }

    private addPenTool(label: string, color: string, semantic: string): void {
        const button = document.createElement('button');
        button.className = 'ink-toolbar-button';
        button.setAttribute('data-semantic', semantic);

        // Create spans with emoji and text
        const iconSpan = document.createElement('span');
        iconSpan.textContent = '✏️';

        const textSpan = document.createElement('span');
        textSpan.textContent = label;

        button.appendChild(iconSpan);
        button.appendChild(textSpan);

        button.addEventListener('click', () => {
            const style: StrokeStyle = {
                width: semantic === 'bold' ? 3.0 : 2.0,
                color,
                semantic: semantic as any
            };

            // Check if the view has setCurrentPenStyle method
            if (typeof (this.view as any).setCurrentPenStyle === 'function') {
                (this.view as any).setCurrentPenStyle(style);
            }

            // Update active state
            this.toolbarEl.querySelectorAll('.ink-toolbar-button').forEach(btn => {
                btn.classList.remove('active');
            });
            button.classList.add('active');
        });

        this.toolbarEl.appendChild(button);
    }

    private addBlockTypeButton(label: string, type: string): void {
        const button = document.createElement('button');
        button.className = 'ink-toolbar-button';
        button.setAttribute('data-block-type', type);

        const icons: Record<string, string> = {
            paragraph: '📝',
            heading: '#',
            math: '∑',
            quote: '❝'
        };

        const iconSpan = document.createElement('span');
        iconSpan.textContent = icons[type] || '□';

        const textSpan = document.createElement('span');
        textSpan.textContent = label;

        button.appendChild(iconSpan);
        button.appendChild(textSpan);

        button.addEventListener('click', () => {
            this.currentBlockType = type;

            // Check if the view has setCurrentBlockType method
            if (typeof (this.view as any).setCurrentBlockType === 'function') {
                (this.view as any).setCurrentBlockType(type);
            }

            // Update active state
            this.toolbarEl.querySelectorAll('[data-block-type]').forEach(btn => {
                btn.classList.remove('active');
            });
            button.classList.add('active');
        });

        this.toolbarEl.appendChild(button);
    }

    private addActionButton(label: string, icon: string, action: () => void): void {
        const button = document.createElement('button');
        button.className = 'ink-toolbar-button action-button';

        const iconSpan = document.createElement('span');
        iconSpan.textContent = icon;

        const textSpan = document.createElement('span');
        textSpan.textContent = label;

        button.appendChild(iconSpan);
        button.appendChild(textSpan);

        button.addEventListener('click', action);

        this.toolbarEl.appendChild(button);
    }

    private clearCanvas(): void {
        if (confirm('Clear all ink?')) {
            // Check if the view has clearCanvas method
            if (typeof (this.view as any).clearCanvas === 'function') {
                (this.view as any).clearCanvas();
            }
        }
    }

    public getCurrentBlockType(): string {
        return this.currentBlockType;
    }
}