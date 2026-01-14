import { FileView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import VectorInkPlugin from '../main';
import { InkDocument } from '../model/InkDocument';
import { Point, Stroke, StrokeStyle } from '../types';

export const INK_VIEW_TYPE = 'ink-view';

export class InkView extends FileView {
    plugin: VectorInkPlugin;
    document: InkDocument | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private isDrawing = false;
    private currentStroke: Point[] = [];
    private currentPenStyle: StrokeStyle = {
        width: 2.0,
        color: '#000000',
        semantic: 'normal'
    };

    constructor(leaf: WorkspaceLeaf, plugin: VectorInkPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return INK_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename || 'Ink Document';
    }

    async onOpen() {
        // Use contentEl from FileView (not containerEl)
        const container = this.contentEl;

        // Clear the container
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        // Add class
        container.classList.add('ink-view-container');

        // Initialize document
        await this.loadDocument();

        // Create toolbar using document.createElement
        const toolbar = document.createElement('div');
        toolbar.className = 'ink-toolbar';

        // Color picker
        const colorPicker = document.createElement('input');
        colorPicker.type = 'color';
        colorPicker.value = this.currentPenStyle.color;
        colorPicker.addEventListener('change', (e: Event) => {
            this.currentPenStyle.color = (e.target as HTMLInputElement).value;
        });
        toolbar.appendChild(colorPicker);

        // Width slider
        const widthSlider = document.createElement('input');
        widthSlider.type = 'range';
        widthSlider.min = '1';
        widthSlider.max = '10';
        widthSlider.value = this.currentPenStyle.width.toString();
        widthSlider.addEventListener('input', (e: Event) => {
            this.currentPenStyle.width = parseInt((e.target as HTMLInputElement).value);
        });
        toolbar.appendChild(widthSlider);

        // Clear button
        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', () => this.clearCanvas());
        toolbar.appendChild(clearBtn);

        // Save button
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', () => this.saveDocument());
        toolbar.appendChild(saveBtn);

        // Digitize button
        const digitizeBtn = document.createElement('button');
        digitizeBtn.textContent = 'Digitize';
        digitizeBtn.addEventListener('click', () => this.digitizeDocument());
        toolbar.appendChild(digitizeBtn);

        container.appendChild(toolbar);

        // Create canvas container
        const canvasContainer = document.createElement('div');
        canvasContainer.className = 'ink-canvas-container';

        this.canvas = document.createElement('canvas');
        this.canvas.width = 800;
        this.canvas.height = 600;
        this.canvas.style.border = '1px solid var(--background-modifier-border)';
        this.canvas.style.borderRadius = '4px';
        this.canvas.style.backgroundColor = 'white';
        this.canvas.style.cursor = 'crosshair';

        this.ctx = this.canvas.getContext('2d');
        if (this.ctx) {
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
        }

        canvasContainer.appendChild(this.canvas);
        container.appendChild(canvasContainer);

        // Setup event listeners
        this.setupCanvasEvents();

        // Draw existing strokes
        this.drawExistingStrokes();
    }

    async onClose() {
        await this.saveDocument();
    }

    async loadDocument() {
        if (!this.file) return;

        try {
            const content = await this.app.vault.read(this.file);
            this.document = InkDocument.fromJSON(content);
        } catch (error) {
            console.log('Creating new ink document');
            this.document = new InkDocument();
        }
    }

    async saveDocument() {
        if (!this.document || !this.file) return;

        try {
            this.document.updateTimestamp();
            const content = this.document.toJSON();
            await this.app.vault.modify(this.file, content);
            new Notice('Ink document saved');
        } catch (error) {
            console.error('Failed to save:', error);
            new Notice('Failed to save document');
        }
    }

    private setupCanvasEvents() {
        if (!this.canvas) return;

        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseleave', () => this.stopDrawing());
    }

    private startDrawing(e: MouseEvent) {
        if (!this.canvas || !this.ctx || !this.document) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.isDrawing = true;
        this.currentStroke = [{
            x,
            y,
            t: Date.now(),
            pressure: 0.5
        }];

        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
    }

    private draw(e: MouseEvent) {
        if (!this.isDrawing || !this.canvas || !this.ctx || !this.document) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.currentStroke.push({
            x,
            y,
            t: Date.now(),
            pressure: 0.5
        });

        this.ctx.lineTo(x, y);
        this.ctx.strokeStyle = this.currentPenStyle.color;
        this.ctx.lineWidth = this.currentPenStyle.width;
        this.ctx.stroke();
    }

    private stopDrawing() {
        if (!this.isDrawing || !this.document) return;

        this.isDrawing = false;

        // Save the stroke
        if (this.currentStroke.length > 1) {
            const stroke: Stroke = {
                id: crypto.randomUUID(),
                points: this.currentStroke,
                style: this.currentPenStyle,
                createdAt: new Date().toISOString()
            };

            // Use the method from InkDocument to add stroke
            this.document.addStroke(stroke);
            this.currentStroke = [];
        }
    }

    private drawExistingStrokes() {
        if (!this.document || !this.ctx || !this.canvas) return;

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw all strokes
        this.document.strokes.forEach(stroke => {
            if (stroke.points.length < 2) return;

            this.ctx!.beginPath();
            this.ctx!.moveTo(stroke.points[0].x, stroke.points[0].y);

            for (let i = 1; i < stroke.points.length; i++) {
                this.ctx!.lineTo(stroke.points[i].x, stroke.points[i].y);
            }

            this.ctx!.strokeStyle = stroke.style.color;
            this.ctx!.lineWidth = stroke.style.width;
            this.ctx!.stroke();
        });
    }

    private clearCanvas() {
        if (!this.document || !this.ctx || !this.canvas) return;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.document.clearStrokes();
    }

    private async digitizeDocument() {
        new Notice('Digitization starting...');

        if (!this.document) return;

        // Create markdown content
        const now = new Date();
        const filename = `Digitized ${now.toISOString().slice(0, 10)}.md`;

        let markdown = `# Digitized Ink Document\n\n`;
        markdown += `*Digitized on: ${now.toLocaleString()}*\n\n`;
        markdown += `## Document Information\n`;
        markdown += `- **ID:** ${this.document.getData().document.id}\n`;
        markdown += `- **Strokes:** ${this.document.strokes.length}\n`;
        markdown += `- **Blocks:** ${this.document.blocks.length}\n\n`;

        if (this.document.strokes.length > 0) {
            markdown += `## Stroke Samples\n`;
            this.document.strokes.slice(0, 5).forEach((stroke, i) => {
                markdown += `${i + 1}. Stroke with ${stroke.points.length} points\n`;
            });
        }

        // Add blocks information
        if (this.document.blocks.length > 0) {
            markdown += `\n## Blocks\n`;
            this.document.blocks.forEach((block, index) => {
                markdown += `${index + 1}. ${block.type} (${block.strokeIds.length} strokes)\n`;
            });
        }

        try {
            const file = await this.app.vault.create(filename, markdown);
            const leaf = this.app.workspace.getLeaf(true);
            await leaf.openFile(file);
            new Notice(`Digitized document created: ${filename}`);
        } catch (error) {
            console.error('Failed to create digitized document:', error);
            new Notice('Failed to create digitized document');
        }
    }
}