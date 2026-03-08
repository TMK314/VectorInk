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
        const isActive = () => this.app.workspace.activeLeaf === this.leaf;

        this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
            if (!isActive()) return;
            // Kein Shortcut wenn ein Input/Select/Textarea fokussiert ist (z.B. Toolbar-Felder)
            const tag = (document.activeElement as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

            const mod = e.ctrlKey || e.metaKey;

            // ── Undo / Redo ────────────────────────────────────────────────────
            if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
                this.historyManager.undo(); e.preventDefault(); return;
            }
            if ((mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
                (mod && (e.key === 'y' || e.key === 'Y'))) {
                this.historyManager.redo(); e.preventDefault(); return;
            }

            // ── Save ───────────────────────────────────────────────────────────
            if (mod && (e.key === 's' || e.key === 'S')) {
                this.saveDocument(); e.preventDefault(); return;
            }

            // ── Tool-Wechsel (bare keys, kein Modifier) ────────────────────────
            if (!mod && !e.shiftKey && !e.altKey) {
                switch (e.key) {
                    case 'p': case 'P':
                        this.drawingManager.setTool('pen'); e.preventDefault(); return;
                    case 'e': case 'E':
                        this.drawingManager.setTool('eraser'); e.preventDefault(); return;
                    case 'v': case 'V':
                        this.drawingManager.setTool('selection'); e.preventDefault(); return;
                    case 'Escape':
                        this.drawingManager.setTool('selection'); e.preventDefault(); return;
                }
            }

            // ── Format-Shortcuts (bare keys, nur wenn Pen aktiv) ───────────────
            if (!mod && !e.shiftKey && !e.altKey &&
                this.drawingManager.currentTool === 'pen') {
                const setSemantic = (s: 'normal' | 'bold' | 'italic' ) => {
                    this.drawingManager.currentPenStyle.semantic = s;
                    this.toolbarManager?.syncSemanticToToolbar(s);
                    e.preventDefault();
                };
                switch (e.key) {
                    case 'n': case 'N': setSemantic('normal'); return;
                    case 'b': case 'B': setSemantic('bold'); return;
                    case 'i': case 'I': setSemantic('italic'); return;
                }
            }

            // ── Auswahl-Aktionen (nur wenn Selection aktiv) ────────────────────
            if (this.drawingManager.currentTool === 'selection') {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    this.strokeSelectionManager.deleteSelectedStrokes();
                    e.preventDefault(); return;
                }
                if (mod && (e.key === 'c' || e.key === 'C')) {
                    this.strokeSelectionManager.copySelectedStrokes();
                    e.preventDefault(); return;
                }
                if (mod && (e.key === 'v' || e.key === 'V')) {
                    this.strokeSelectionManager.pasteStrokes(this.currentBlockIndex);
                    e.preventDefault(); return;
                }
                if (mod && (e.key === 'a' || e.key === 'A')) {
                    const block = this.blocks[this.currentBlockIndex];
                    if (block) {
                        this.strokeSelectionManager.selectedStrokes.clear();
                        block.strokeIds.forEach(id =>
                            this.strokeSelectionManager.selectedStrokes.add(id));
                        this.blockManager.renderBlocks();
                    }
                    e.preventDefault(); return;
                }
            }
        });

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

        const themeObserver = (this as any)._themeObserver;
        if (themeObserver) {
            themeObserver.disconnect();
        }
    }
}