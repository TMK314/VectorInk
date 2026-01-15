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
        console.log('🚀 InkView.onOpen() called');
        console.log('📄 Current file:', this.file?.path);

        // Clear container
        while (this.contentEl.firstChild) {
            this.contentEl.removeChild(this.contentEl.firstChild);
        }

        this.contentEl.classList.add('ink-view-container');

        // Load document FIRST
        console.log('📖 Loading document...');
        await this.loadDocument();
        console.log('📖 Document loaded:', this.document ? 'Yes' : 'No');

        // Create toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'ink-toolbar';

        // Create simple test button
        const testButton = document.createElement('button');
        testButton.textContent = 'Test Draw';
        testButton.addEventListener('click', () => this.testDraw());
        toolbar.appendChild(testButton);

        // Clear button
        const clearButton = document.createElement('button');
        clearButton.textContent = 'Clear';
        clearButton.addEventListener('click', () => this.clearCanvas());
        toolbar.appendChild(clearButton);

        // Save button
        const saveButton = document.createElement('button');
        saveButton.textContent = 'Save';
        saveButton.addEventListener('click', () => this.saveDocument());
        toolbar.appendChild(saveButton);

        this.contentEl.appendChild(toolbar);

        // Create canvas container
        const canvasContainer = document.createElement('div');
        canvasContainer.className = 'ink-canvas-container';
        canvasContainer.style.padding = '20px';

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = 800;
        this.canvas.height = 600;
        this.canvas.style.border = '2px solid var(--background-modifier-border)';
        this.canvas.style.borderRadius = '4px';
        this.canvas.style.backgroundColor = 'white';
        this.canvas.style.cursor = 'crosshair';

        this.ctx = this.canvas.getContext('2d');
        if (this.ctx) {
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
        }

        canvasContainer.appendChild(this.canvas);
        this.contentEl.appendChild(canvasContainer);

        // Setup event listeners
        this.setupCanvasEvents();

        // Draw existing strokes
        console.log('🎨 Calling drawExistingStrokes...');
        this.drawExistingStrokes();

        console.log('✅ InkView.onOpen() completed');
    }

    private testDraw() {
        console.log('🖍️ testDraw() called');

        if (!this.ctx || !this.canvas) {
            console.log('❌ Canvas or context not available');
            return;
        }

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw a simple test pattern
        this.ctx.fillStyle = '#f0f0f0';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw a red line
        this.ctx.beginPath();
        this.ctx.moveTo(50, 50);
        this.ctx.lineTo(200, 200);
        this.ctx.strokeStyle = 'red';
        this.ctx.lineWidth = 3;
        this.ctx.stroke();

        // Draw a blue circle
        this.ctx.beginPath();
        this.ctx.arc(300, 150, 50, 0, Math.PI * 2);
        this.ctx.fillStyle = 'blue';
        this.ctx.fill();

        // Draw text
        this.ctx.fillStyle = 'black';
        this.ctx.font = '16px Arial';
        this.ctx.fillText('Canvas is working!', 50, 300);

        // Draw grid
        this.ctx.strokeStyle = '#e0e0e0';
        this.ctx.lineWidth = 1;

        for (let x = 0; x <= this.canvas.width; x += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }

        for (let y = 0; y <= this.canvas.height; y += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }

        console.log('✅ Test pattern drawn');
    }

    async onClose() {
        await this.saveDocument();
    }

    async loadDocument(): Promise<void> {
        if (!this.file) {
            console.log('❌ No file to load');
            this.document = new InkDocument();
            return;
        }

        try {
            console.log('📂 Loading file:', this.file.path);
            const content = await this.app.vault.read(this.file);

            // Check if content is empty
            if (!content || content.trim().length === 0) {
                console.log('📄 File is empty, creating new document');
                this.document = new InkDocument();
                return;
            }

            // Try to parse as JSON
            try {
                const parsed = JSON.parse(content);
                console.log('✅ Valid JSON, creating document');
                this.document = new InkDocument(parsed);
                console.log('📊 Document loaded with', this.document.strokes.length, 'strokes');
            } catch (jsonError) {
                console.log('❌ Not valid JSON, creating new document:', jsonError);
                this.document = new InkDocument();
            }

        } catch (error) {
            console.log('❌ Error loading document, creating new one:', error);
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

            // Safe error message
            if (error instanceof Error) {
                new Notice(`Failed to save: ${error.message}`);
            } else {
                new Notice('Failed to save document');
            }
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
        console.log('🎨 drawExistingStrokes() called');

        if (!this.document) {
            console.log('❌ No document available');
            this.testDraw(); // Fallback to test draw
            return;
        }

        if (!this.ctx || !this.canvas) {
            console.log('❌ Canvas or context not available');
            return;
        }

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        console.log(`📊 Document has ${this.document.strokes.length} strokes`);

        if (this.document.strokes.length === 0) {
            console.log('ℹ️ No strokes to draw');
            // Draw a simple test to show canvas is working
            this.ctx.fillStyle = '#f9f9f9';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

            this.ctx.fillStyle = '#666';
            this.ctx.font = '14px Arial';
            this.ctx.fillText('No strokes in document. Use the canvas to draw.', 20, 30);
            return;
        }

        // Draw each stroke
        this.document.strokes.forEach((stroke, index) => {
            console.log(`🖋️ Drawing stroke ${index}: ${stroke.points.length} points`);

            if (stroke.points.length < 2) {
                console.log(`⚠️ Stroke ${index} has less than 2 points, skipping`);
                return;
            }

            this.ctx!.beginPath();

            // Start at first point
            const firstPoint = stroke.points[0];
            if (!firstPoint) {
                console.log(`⚠️ Stroke ${index} has no first point, skipping`);
                return;
            }

            this.ctx!.moveTo(firstPoint.x, firstPoint.y);

            // Draw lines to each subsequent point
            for (let i = 1; i < stroke.points.length; i++) {
                const point = stroke.points[i];
                if (!point) continue;
                this.ctx!.lineTo(point.x, point.y);
            }

            this.ctx!.strokeStyle = stroke.style.color;
            this.ctx!.lineWidth = stroke.style.width;
            this.ctx!.stroke();
        });

        console.log('✅ Finished drawing strokes');
    }

    private drawGrid() {
        if (!this.ctx || !this.canvas) return;

        this.ctx.strokeStyle = '#e5e5e5';
        this.ctx.lineWidth = 0.5;

        // Draw vertical lines
        for (let x = 0; x <= this.canvas.width; x += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();

            // Label
            this.ctx.fillStyle = '#999';
            this.ctx.font = '10px Arial';
            this.ctx.fillText(x.toString(), x + 2, 10);
        }

        // Draw horizontal lines
        for (let y = 0; y <= this.canvas.height; y += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();

            // Label
            this.ctx.fillText(y.toString(), 2, y - 2);
        }
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