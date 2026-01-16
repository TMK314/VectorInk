import { FileView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import VectorInkPlugin from '../main';
import { InkDocument } from '../model/InkDocument';
import { Point, Stroke, StrokeStyle, Block, BlockType, BoundingBox } from '../types';

export const INK_VIEW_TYPE = 'ink-view';

export class InkView extends FileView {
    plugin: VectorInkPlugin;
    document: InkDocument | null = null;

    private isDrawing = false;
    private currentStroke: Point[] = [];

    private currentPenStyle: StrokeStyle = {
        width: 2.0,
        color: '#000000',
        semantic: 'normal'
    };

    /* ---------------- Block-Verwaltung ---------------- */

    private blocksContainer: HTMLElement | null = null;
    private currentBlockIndex = -1;
    private blocks: Block[] = [];
    private blockTypeSelector: HTMLSelectElement | null = null;

    private blockTypeMapping: Record<string, BlockType> = {
        paragraph: 'paragraph',
        heading: 'heading',
        math: 'math',
        quote: 'quote',
        drawing: 'drawing',
        table: 'table'
    };

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
        await this.loadDocument();
        await this.setupUI();
    }

    async onClose(): Promise<void> {
        await this.saveDocument();
    }

    /* ---------------- Utility ---------------- */

    private getCurrentBlock(): Block | null {
        if (
            this.currentBlockIndex < 0 ||
            this.currentBlockIndex >= this.blocks.length
        ) {
            return null;
        }
        return this.blocks[this.currentBlockIndex] ?? null;
    }

    /* ---------------- UI Setup ---------------- */

    async setupUI(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.classList.add('ink-view-container');

        const main = document.createElement('div');
        main.style.display = 'flex';
        main.style.flexDirection = 'column';
        main.style.height = '100%';
        this.contentEl.appendChild(main);

        const toolbar = this.createToolbar();
        if (toolbar) main.appendChild(toolbar);

        this.blocksContainer = document.createElement('div');
        this.blocksContainer.style.flex = '1';
        this.blocksContainer.style.overflow = 'auto';
        this.blocksContainer.style.padding = '10px';
        main.appendChild(this.blocksContainer);

        if (!this.document) return;

        this.blocks = [...this.document.blocks];

        if (this.blocks.length === 0) {
            this.blocks.push(this.createBlock('paragraph', 0));
            this.currentBlockIndex = 0;
        } else {
            this.currentBlockIndex = 0;
        }

        this.renderBlocks();
    }

    createToolbar(): HTMLElement {
        const toolbar = document.createElement('div');
        toolbar.style.display = 'flex';
        toolbar.style.gap = '10px';
        toolbar.style.padding = '10px';

        this.blockTypeSelector = document.createElement('select');

        Object.keys(this.blockTypeMapping).forEach(key => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = key;
            this.blockTypeSelector!.appendChild(opt);
        });

        this.blockTypeSelector.addEventListener('change', e => {
            const block = this.getCurrentBlock();
            if (!block) return;

            const value = (e.target as HTMLSelectElement).value;
            block.type = this.blockTypeMapping[value] ?? 'paragraph';
            this.renderBlocks();
        });

        toolbar.appendChild(this.blockTypeSelector);

        const add = document.createElement('button');
        add.textContent = '+ Block';
        add.onclick = () => this.addBlock();
        toolbar.appendChild(add);

        const up = document.createElement('button');
        up.textContent = '↑';
        up.onclick = () => this.moveBlockUp();
        toolbar.appendChild(up);

        const down = document.createElement('button');
        down.textContent = '↓';
        down.onclick = () => this.moveBlockDown();
        toolbar.appendChild(down);

        const save = document.createElement('button');
        save.textContent = 'Save';
        save.onclick = () => this.saveDocument();
        toolbar.appendChild(save);

        return toolbar;
    }

    /* ---------------- Blocks ---------------- */

    createBlock(type: BlockType, order: number): Block {
        return {
            id: crypto.randomUUID(),
            type,
            strokeIds: [],
            order,
            bbox: {
                x: 20,
                y: order * 250 + 20,
                width: 760,
                height: 200
            }
        };
    }

    renderBlocks(): void {
        if (!this.blocksContainer) return;

        this.blocksContainer.empty();
        this.blocks.sort((a, b) => a.order - b.order);

        this.blocks.forEach((block, index) => {
            this.blocksContainer!.appendChild(
                this.createBlockElement(block, index)
            );
        });

        const current = this.getCurrentBlock();
        if (current && this.blockTypeSelector) {
            this.blockTypeSelector.value =
                Object.keys(this.blockTypeMapping).find(
                    k => this.blockTypeMapping[k] === current.type
                ) ?? 'paragraph';
        }
    }


    createBlockElement(block: Block, index: number): HTMLElement {
        const el = document.createElement('div');
        el.style.border = index === this.currentBlockIndex ? '2px solid blue' : '1px solid #ccc';
        el.style.padding = '10px';
        el.style.marginBottom = '10px';

        const header = document.createElement('div');
        header.textContent = `Block ${index + 1} (${block.type})`;
        header.style.fontWeight = 'bold';
        el.appendChild(header);

        const canvas = document.createElement('canvas');
        canvas.width = block.bbox.width;
        canvas.height = block.bbox.height;
        canvas.style.border = '1px solid #ccc';
        el.appendChild(canvas);

        this.setupCanvasEvents(canvas, index);
        this.drawBlockStrokes(canvas, block);

        el.onclick = () => {
            this.currentBlockIndex = index;
            this.renderBlocks();
        };

        return el;
    }

    addBlock(): void {
        const block = this.createBlock('paragraph', this.blocks.length);
        this.blocks.push(block);
        this.currentBlockIndex = this.blocks.length - 1;
        this.renderBlocks();
    }

    moveBlockUp(): void {
        const i = this.currentBlockIndex;
        if (i <= 0) return;

        const current = this.blocks[i];
        const previous = this.blocks[i - 1];

        if (!current || !previous) return;

        // Swap orders
        const tmpOrder = current.order;
        current.order = previous.order;
        previous.order = tmpOrder;

        // Swap array positions (OHNE Destructuring)
        this.blocks[i - 1] = current;
        this.blocks[i] = previous;

        this.currentBlockIndex = i - 1;
        this.renderBlocks();
    }

    moveBlockDown(): void {
        const i = this.currentBlockIndex;
        if (i < 0 || i >= this.blocks.length - 1) return;

        const current = this.blocks[i];
        const next = this.blocks[i + 1];

        if (!current || !next) return;

        const tmpOrder = current.order;
        current.order = next.order;
        next.order = tmpOrder;

        this.blocks[i] = next;
        this.blocks[i + 1] = current;

        this.currentBlockIndex = i + 1;
        this.renderBlocks();
    }

    /* ---------------- Drawing ---------------- */

    setupCanvasEvents(canvas: HTMLCanvasElement, blockIndex: number): void {
        canvas.onmousedown = e => this.startDrawing(e, canvas, blockIndex);
        canvas.onmousemove = e => this.draw(e, canvas, blockIndex);
        canvas.onmouseup = () => this.stopDrawing(blockIndex);
        canvas.onmouseleave = () => this.stopDrawing(blockIndex);
    }

    startDrawing(e: MouseEvent, canvas: HTMLCanvasElement, blockIndex: number): void {
        if (blockIndex !== this.currentBlockIndex) return;
        this.isDrawing = true;
        this.currentStroke = [{ x: e.offsetX, y: e.offsetY, t: Date.now(), pressure: 0.5 }];
    }

    draw(e: MouseEvent, canvas: HTMLCanvasElement, blockIndex: number): void {
        if (!this.isDrawing || blockIndex !== this.currentBlockIndex) return;
        this.currentStroke.push({ x: e.offsetX, y: e.offsetY, t: Date.now(), pressure: 0.5 });

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.strokeStyle = this.currentPenStyle.color;
        ctx.lineWidth = this.currentPenStyle.width;
        ctx.lineTo(e.offsetX, e.offsetY);
        ctx.stroke();
    }

    stopDrawing(blockIndex: number): void {
        if (!this.isDrawing || !this.document) return;
        this.isDrawing = false;

        if (this.currentStroke.length < 2) return;

        const block = this.getCurrentBlock();
        if (!block) return;

        const stroke: Stroke = {
            id: crypto.randomUUID(),
            points: this.currentStroke,
            style: this.currentPenStyle,
            createdAt: new Date().toISOString()
        };

        const added = this.document.addStroke(stroke);
        block.strokeIds.push(added.id);
        this.currentStroke = [];
    }

    drawBlockStrokes(canvas: HTMLCanvasElement, block: Block): void {
        if (!this.document) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const strokeId of block.strokeIds) {
            const stroke = this.document.strokes.find(s => s.id === strokeId);
            if (!stroke || stroke.points.length < 2) continue;

            const first = stroke.points[0];
            if (!first) continue;

            ctx.beginPath();
            ctx.moveTo(first.x, first.y);

            for (let i = 1; i < stroke.points.length; i++) {
                const p = stroke.points[i];
                if (!p) continue;
                ctx.lineTo(p.x, p.y);
            }

            ctx.strokeStyle = stroke.style.color;
            ctx.lineWidth = stroke.style.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        }
    }

    /* ---------------- Persistence ---------------- */

    async loadDocument(): Promise<void> {
        if (!this.file) {
            this.document = new InkDocument();
            return;
        }

        try {
            const raw = await this.app.vault.read(this.file);
            this.document = raw ? new InkDocument(JSON.parse(raw)) : new InkDocument();
        } catch {
            this.document = new InkDocument();
        }
    }

    async saveDocument(): Promise<void> {
        if (!this.document || !this.file) return;

        this.document.clearBlocks();
        this.blocks.forEach(b => this.document!.addBlock(b));

        await this.app.vault.modify(this.file, this.document.toJSON());
        new Notice('Ink document saved');
    }
}
