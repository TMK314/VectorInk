import { FileView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import VectorInkPlugin from '../main';
import { InkDocument } from '../model/InkDocument';
import { Point, Stroke, StrokeStyle, Block, BlockType, BoundingBox, PartialBlock } from '../types';
import { BezierCurveFitter } from 'bezierFitting';
import { CubicBezier } from 'bezierFitting';
import { BlockManager } from './block-manager';
import { DrawingManager } from './drawing-manager';
import { ToolbarManager } from './toolbar-manager';
import { StyleManager } from './style-manager';
import { StrokeSelectionManager } from './stroke-selection-manager';
import { HistoryManager } from './history-manager';

export const INK_VIEW_TYPE = 'ink-view';

export class InkView extends FileView {
    plugin: VectorInkPlugin;
    document: InkDocument | null = null;

    // Manager instances
    public blockManager: BlockManager;
    public drawingManager: DrawingManager;
    public toolbarManager: ToolbarManager;
    public styleManager: StyleManager;

    // Shared state
    public blocks: Block[] = [];
    public currentBlockIndex = 0;
    public blocksContainer: HTMLElement | null = null;
    public viewScale: number = 1.0;

    public strokeSelectionManager: StrokeSelectionManager;
    public historyManager: HistoryManager;

    constructor(leaf: WorkspaceLeaf, plugin: VectorInkPlugin) {
        super(leaf);
        this.plugin = plugin;

        // Initialize managers
        this.styleManager = new StyleManager(this);
        this.strokeSelectionManager = new StrokeSelectionManager(this);
        this.drawingManager = new DrawingManager(this);
        this.blockManager = new BlockManager(this);
        this.toolbarManager = new ToolbarManager(this);
        this.historyManager = new HistoryManager(this);
    }

    getViewType(): string {
        return INK_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.basename ?? 'Ink Document';
    }

    async onOpen(): Promise<void> {
        await this.loadDocument();
        this.blocks = this.document ? [...this.document.blocks].sort((a, b) => a.order - b.order) : [];
        this.contentEl.empty();
        await this.setupUI();
    }

    async onClose(): Promise<void> {
        try {
            await this.saveDocument();
        } catch (error) {
            console.error('Failed to save on close:', error);
        }

        const handleKeyDown = (this as any)._handleKeyDown;
        if (handleKeyDown) {
            document.removeEventListener('keydown', handleKeyDown);
        }

        // Cleanup theme observer
        const themeObserver = (this as any)._themeObserver;
        if (themeObserver) {
            themeObserver.disconnect();
        }
    }

    async setupUI(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.classList.add('ink-view-container');
        this.contentEl.style.backgroundColor = 'var(--background-primary)';

        const main = document.createElement('div');
        main.style.display = 'flex';
        main.style.flexDirection = 'column';
        main.style.height = '100%';
        main.style.overflow = 'hidden';
        main.style.backgroundColor = 'var(--background-primary)';
        this.contentEl.appendChild(main);

        if (this.document) {
            this.blocks = [...this.document.blocks].sort((a, b) => a.order - b.order);
        } else {
            this.blocks = [];
        }

        this.toolbarManager.createToolbar(main);

        // Äußerer Scroll-Wrapper
        const scrollWrapper = document.createElement('div');
        scrollWrapper.style.cssText = 'flex:1;overflow:auto;background:var(--background-primary);';
        main.appendChild(scrollWrapper);

        // Innerer zentrierter Container – hier landen alle Block-Elemente
        this.blocksContainer = document.createElement('div');
        this.blocksContainer.style.cssText =
            'max-width:880px;margin:0 auto;padding:24px 20px;' +
            'display:flex;flex-direction:column;align-items:center;';
        this.blocksContainer.style.zoom = String(this.viewScale);
        scrollWrapper.appendChild(this.blocksContainer);

        if (this.document) {
            this.blocks = [...this.document.blocks].sort((a, b) => a.order - b.order);
            if (this.blocks.length === 0) {
                this.blockManager.addNewBlock('paragraph', 0, true);
            }
        }

        this.blockManager.renderBlocks();
        this.setupEventListeners();
        this.styleManager.setupThemeObserver();
    }

    private setupEventListeners(): void {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!this.contentEl.contains(document.activeElement)) return;

            const currentBlock = this.blocks[this.currentBlockIndex];

            // Undo / Redo
            if (e.ctrlKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
                this.historyManager.undo();
                e.preventDefault();
                return;
            }
            if ((e.ctrlKey && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
                (e.ctrlKey && (e.key === 'y' || e.key === 'Y'))) {
                this.historyManager.redo();
                e.preventDefault();
                return;
            }

            // Handle stroke manipulation shortcuts
            if (this.drawingManager.currentTool === 'selection') {
                switch (e.key) {
                    case 'Delete':
                        this.strokeSelectionManager.deleteSelectedStrokes();
                        e.preventDefault();
                        return;

                    case 'c':
                    case 'C':
                        if (e.ctrlKey) {
                            this.strokeSelectionManager.copySelectedStrokes();
                            e.preventDefault();
                            return;
                        }
                        break;

                    case 'v':
                    case 'V':
                        if (e.ctrlKey) {
                            this.strokeSelectionManager.pasteStrokes(this.currentBlockIndex);
                            e.preventDefault();
                            return;
                        }
                        break;

                    case 'a':
                    case 'A':
                        if (e.ctrlKey) {
                            // Select all strokes in current block
                            const block = this.blocks[this.currentBlockIndex];
                            if (block) {
                                this.strokeSelectionManager.selectedStrokes.clear();
                                block.strokeIds.forEach(id => {
                                    this.strokeSelectionManager.selectedStrokes.add(id);
                                });
                                this.blockManager.renderBlocks();
                            }
                            e.preventDefault();
                            return;
                        }
                        break;

                    case 'Escape':
                        this.strokeSelectionManager.clearSelection();
                        this.blockManager.renderBlocks();
                        e.preventDefault();
                        return;
                }
            }

            // Handle table and other shortcuts
            switch (e.key) {
                case 'Escape':
                    this.drawingManager.setTool('selection');
                    break;
                case 'p':
                case 'P':
                    if (e.ctrlKey) {
                        this.drawingManager.setTool('pen');
                        e.preventDefault();
                    }
                    break;

                case 'e':
                case 'E':
                    if (e.ctrlKey) {
                        this.drawingManager.setTool('eraser');
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
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        window.addEventListener('resize', () => {
            if (!this.blocksContainer) return;
            this.blocks.forEach(block => {
                const canvas = this.blockManager.getCanvasForBlock(block.id);
                if (canvas) this.drawingManager.updateBlockCanvasSize(block, canvas);
            });
        });

        (this as any)._handleKeyDown = handleKeyDown;
    }

    // WICHTIG: Diese Methode wird von Obsidian aufgerufen, wenn die Datei gewechselt wird
    async onLoadFile(file: TFile): Promise<void> {
        console.log('🔄 Loading file:', file.path);

        // Datei wechseln
        this.file = file;

        // UI zurücksetzen
        this.contentEl.empty();
        this.document = null;
        this.blocks = [];
        this.currentBlockIndex = 0;
        this.historyManager.clear();
        this.blocksContainer = null;

        // Neues Dokument laden
        await this.loadDocument(); // WICHTIG: Erst Dokument laden

        // UI neu aufbauen
        await this.setupUI(); // Dann UI aufbauen

        // Scroll positionieren
        if (this.blocksContainer) {
            (this.blocksContainer as HTMLElement).scrollTop = 0;
        }
    }

    async loadDocument(): Promise<void> {
        if (!this.file) {
            this.document = new InkDocument();
            return;
        }

        try {
            const raw = await this.app.vault.read(this.file);

            this.document = raw
                ? InkDocument.fromJSON(raw)
                : new InkDocument();

            if (this.document) {
                this.blocks = [...this.document.blocks]
                    .sort((a, b) => a.order - b.order);
            }

        } catch (error) {
            console.error('Error loading document:', error);
            this.document = new InkDocument();
        }
    }

    async saveDocument(silent = false): Promise<void> {
        if (!this.document || !this.file) {
            console.error('❌ No document or file to save');
            new Notice('No document to save');
            return;
        }

        try {
            console.log('💾 Saving document...');

            const docData = this.document.getData();

            // Blocks synchronisieren
            docData.blocks = this.blocks.map(block => ({
                ...block,
                strokeIds: [...block.strokeIds]
            })).sort((a, b) => a.order - b.order);

            // Unbenutzte Strokes entfernen
            const usedStrokeIds = new Set<string>();
            docData.blocks.forEach(block => {
                block.strokeIds.forEach(id => usedStrokeIds.add(id));
            });

            docData.strokes = docData.strokes.filter(stroke =>
                usedStrokeIds.has(stroke.id)
            );

            // Dokument neu instanziieren (sauberer Zustand)
            const preservedIdCounter = this.document.idCounter;
            this.document = new InkDocument(docData, preservedIdCounter);

            // 🔥 WICHTIG: jetzt V2 Serialisierung nutzen
            const serialized = this.document.toJSON();

            await this.app.vault.modify(this.file, serialized);

            console.log('✅ Document saved successfully');
            if (!silent) new Notice('Document saved');

        } catch (error) {
            console.error('❌ Failed to save document:', error);
            new Notice(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public setViewScale(v: number): void {
        this.viewScale = v;
        if (this.blocksContainer) {
            (this.blocksContainer as HTMLElement).style.zoom = String(v);
        }
    }

    onunload(): void {
        const handleKeyDown = (this as any)._handleKeyDown;
        if (handleKeyDown) {
            document.removeEventListener('keydown', handleKeyDown);
        }

        // Cleanup theme observer
        const themeObserver = (this as any)._themeObserver;
        if (themeObserver) {
            themeObserver.disconnect();
        }
    }
}