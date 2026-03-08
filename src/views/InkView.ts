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

        // Äußerer Scroll-Wrapper – nur overflow, kein Flex
        const scrollWrapper = document.createElement('div');
        scrollWrapper.style.cssText =
            'flex:1;overflow:auto;background:var(--background-primary);';
        main.appendChild(scrollWrapper);

        // Mittlerer Centering-Wrapper – min-width:max-content zwingt den scrollbaren
        // Bereich, die volle gezoomte Breite zu kennen → linke Seite bleibt erreichbar.
        // display:flex + justify-content:center zentriert den Inhalt.
        const centeringWrapper = document.createElement('div');
        centeringWrapper.style.cssText =
            'min-width:max-content;display:flex;justify-content:center;';
        scrollWrapper.appendChild(centeringWrapper);

        // Innerer Container – feste Breite, kein margin:auto nötig
        this.blocksContainer = document.createElement('div');
        this.blocksContainer.style.cssText =
            'width:880px;flex-shrink:0;padding:24px 20px;' +
            'display:flex;flex-direction:column;align-items:center;';
        this.blocksContainer.style.zoom = String(this.viewScale);
        centeringWrapper.appendChild(this.blocksContainer);

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
        if (!this.scope) return;
        // Obsidian Scope – feuert nur wenn diese View aktiv ist
        this.scope.register(['Mod'], 'z', () => {
            this.historyManager.undo();
            return false;
        });
        this.scope.register(['Mod', 'Shift'], 'z', () => {
            this.historyManager.redo();
            return false;
        });
        this.scope.register(['Mod'], 'y', () => {
            this.historyManager.redo();
            return false;
        });
        this.scope.register(['Mod'], 's', () => {
            this.saveDocument();
            return false;
        });
        this.scope.register(['Mod'], 'p', () => {
            this.drawingManager.setTool('pen');
            return false;
        });
        this.scope.register(['Mod'], 'e', () => {
            this.drawingManager.setTool('eraser');
            return false;
        });
        this.scope.register([], 'Escape', () => {
            this.drawingManager.setTool('selection');
            return false;
        });
        this.scope.register([], 'Delete', () => {
            if (this.drawingManager.currentTool === 'selection')
                this.strokeSelectionManager.deleteSelectedStrokes();
            return false;
        });
        this.scope.register(['Mod'], 'c', () => {
            if (this.drawingManager.currentTool === 'selection')
                this.strokeSelectionManager.copySelectedStrokes();
            return false;
        });
        this.scope.register(['Mod'], 'v', () => {
            if (this.drawingManager.currentTool === 'selection')
                this.strokeSelectionManager.pasteStrokes(this.currentBlockIndex);
            return false;
        });
        this.scope.register(['Mod'], 'a', () => {
            if (this.drawingManager.currentTool === 'selection') {
                const block = this.blocks[this.currentBlockIndex];
                if (block) {
                    this.strokeSelectionManager.selectedStrokes.clear();
                    block.strokeIds.forEach(id => this.strokeSelectionManager.selectedStrokes.add(id));
                    this.blockManager.renderBlocks();
                }
            }
            return false;
        });

        // Resize bleibt als window-Listener
        window.addEventListener('resize', () => {
            if (!this.blocksContainer) return;
            this.blocks.forEach(block => {
                const canvas = this.blockManager.getCanvasForBlock(block.id);
                if (canvas) this.drawingManager.updateBlockCanvasSize(block, canvas);
            });
        });
    }

    // Wird von Obsidian aufgerufen bevor die Datei gewechselt wird (auch zwischen Ink-Dateien)
    async onUnloadFile(file: TFile): Promise<void> {
        if (this.document && this.file) {
            await this.saveDocument(true);
        }
    }

    // WICHTIG: Diese Methode wird von Obsidian aufgerufen, wenn die Datei gewechselt wird
    async onLoadFile(file: TFile): Promise<void> {
        // Datei wechseln
        this.file = file;

        // UI zurücksetzen
        this.contentEl.empty();
        this.document = null;
        this.blocks = [];
        this.currentBlockIndex = 0;
        this.historyManager.clear();
        this.drawingManager.reset();   // Cache + transienten Zustand leeren
        this.blocksContainer = null;

        // Neues Dokument laden
        await this.loadDocument();

        // UI neu aufbauen
        await this.setupUI();

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
            if (!silent) new Notice('No document to save');
            return;
        }

        try {
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

            const serialized = this.document.toJSON();

            await this.app.vault.modify(this.file, serialized);

            if (!silent) new Notice('Document saved');

        } catch (error) {
            console.error('❌ Failed to save document:', error);
            if (!silent) new Notice(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public setViewScale(v: number): void {
        this.viewScale = v;
        if (this.blocksContainer) {
            (this.blocksContainer as HTMLElement).style.zoom = String(v);
        }
        // Canvas-Backing aller Blöcke an neuen effectiveDpr anpassen
        // (verhindert Overflow wenn transform > canvas.width)
        this.drawingManager?.resizeAllCanvasesForViewScale();
    }

    onunload(): void {
        // Speichern beim Entladen (z.B. Plugin-Deaktivierung)
        if (this.document && this.file) {
            this.saveDocument(true).catch(e =>
                console.error('Failed to save on unload:', e)
            );
        }

        const handleKeyDown = (this as any)._handleKeyDown;
        if (handleKeyDown) {
            document.removeEventListener('keydown', handleKeyDown);
        }

        const themeObserver = (this as any)._themeObserver;
        if (themeObserver) {
            themeObserver.disconnect();
        }
    }
}