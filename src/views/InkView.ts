import { FileView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import VectorInkPlugin from '../main';
import { InkDocument } from '../model/InkDocument';
import { Point, Stroke, StrokeStyle, Block, BlockType, BoundingBox, PartialBlock } from '../types';
import { BezierCurveFitter } from 'bezierFitting';
import { CubicBezier } from 'bezierFitting';
import { BlockManager } from './block-manager';
import { DrawingManager } from './drawing-manager';
import { ToolbarManager } from './toolbar-manager';
import { DigitalizationManager } from './digitalization-manager';
import { StyleManager } from './style-manager';
import { StrokeSelectionManager } from './stroke-selection-manager';

export const INK_VIEW_TYPE = 'ink-view';

export class InkView extends FileView {
    plugin: VectorInkPlugin;
    document: InkDocument | null = null;

    // Manager instances
    public blockManager: BlockManager;
    public drawingManager: DrawingManager;
    public toolbarManager: ToolbarManager;
    public digitalizationManager: DigitalizationManager;
    public styleManager: StyleManager;

    // Shared state
    public blocks: Block[] = [];
    public currentBlockIndex = 0;
    public blocksContainer: HTMLElement | null = null;

    public strokeSelectionManager: StrokeSelectionManager;

    constructor(leaf: WorkspaceLeaf, plugin: VectorInkPlugin) {
        super(leaf);
        this.plugin = plugin;

        // Initialize managers
        this.styleManager = new StyleManager(this);
        this.strokeSelectionManager = new StrokeSelectionManager(this);
        this.drawingManager = new DrawingManager(this);
        this.blockManager = new BlockManager(this);
        this.digitalizationManager = new DigitalizationManager(this);
        this.toolbarManager = new ToolbarManager(this);
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

        this.toolbarManager.createToolbar(main);

        this.blocksContainer = document.createElement('div');
        this.blocksContainer.style.flex = '1';
        this.blocksContainer.style.overflow = 'auto';
        this.blocksContainer.style.padding = '20px';
        this.blocksContainer.style.backgroundColor = 'var(--background-primary)';
        main.appendChild(this.blocksContainer);

        if (this.document) {
            this.blocks = [...this.document.blocks].sort((a, b) => a.order - b.order);
            if (this.blocks.length === 0) {
                this.blockManager.addNewBlock('paragraph', 0, true);
            } else {
                // Tabellen initialisieren für geladene Blöcke
                this.blocks.forEach(block => {
                    if (block.type === 'table' && !block.tableGrid) {
                        this.blockManager.initializeTableBlock(block.id, 3, 3);
                    }
                });
            }
        }

        this.blockManager.renderBlocks();
        this.setupEventListeners();
        this.styleManager.setupThemeObserver();

        // Tabellen-Tools Sichtbarkeit aktualisieren - mit Timeout um sicherzustellen, dass alles geladen ist
        setTimeout(() => {
            this.toolbarManager.updateTableToolsVisibility();
        }, 100);
    }

    private setupEventListeners(): void {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!this.contentEl.contains(document.activeElement)) return;

            const currentBlock = this.blocks[this.currentBlockIndex];
            const isTableBlock = currentBlock && currentBlock.type === 'table';
            const tableToolMode = this.blockManager.getTableToolMode();

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
                                new Notice(`Selected ${block.strokeIds.length} stroke(s)`);
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
                    // Tabellen-Tool-Modus beenden, falls aktiv
                    if (tableToolMode) {
                        this.blockManager.setTableToolMode(null);
                        new Notice('Table edit mode exited');
                    }
                    break;

                case 'ArrowUp':
                case 'ArrowDown':
                    if (isTableBlock && tableToolMode === 'move-line') {
                        // Feinjustierung von Linien mit Pfeiltasten
                        const selectedLine = this.blockManager.getSelectedLine();
                        if (selectedLine) {
                            const adjustment = e.key === 'ArrowUp' ? -1 : 1;
                            if (selectedLine.type === 'horizontal') {
                                // Bewege horizontale Linie um 1 Pixel
                                if (currentBlock.tableGrid?.rowHeights[selectedLine.index] === undefined) return;
                                this.blockManager.moveGridLine(
                                    currentBlock.id,
                                    'horizontal',
                                    selectedLine.index,
                                    currentBlock.tableGrid.rowHeights[selectedLine.index]! + adjustment
                                );
                            } else {
                                if (currentBlock.tableGrid?.colWidths[selectedLine.index] === undefined) return;
                                // Bewege vertikale Linie um 1 Pixel
                                this.blockManager.moveGridLine(
                                    currentBlock.id,
                                    'vertical',
                                    selectedLine.index,
                                    currentBlock.tableGrid!.colWidths[selectedLine.index]! + adjustment
                                );
                            }
                            e.preventDefault();
                        }
                    }
                    break;

                case 'ArrowLeft':
                case 'ArrowRight':
                    if (isTableBlock && tableToolMode === 'move-line') {
                        // Feinjustierung von vertikalen Linien mit Pfeiltasten
                        const selectedLine = this.blockManager.getSelectedLine();
                        if (selectedLine && selectedLine.type === 'vertical') {
                            const adjustment = e.key === 'ArrowLeft' ? -1 : 1;
                            if (currentBlock.tableGrid?.colWidths[selectedLine.index] === undefined) return;
                            this.blockManager.moveGridLine(
                                currentBlock.id,
                                'vertical',
                                selectedLine.index,
                                currentBlock.tableGrid!.colWidths[selectedLine.index]! + adjustment
                            );
                            e.preventDefault();
                        }
                    }
                    break;

                case 'Backspace':
                    // Im Tabellen-Modus: Linien ausblenden statt löschen
                    if (isTableBlock && tableToolMode === 'move-line') {
                        e.preventDefault();
                    }
                    break;

                case 'r':
                case 'R':
                    if (e.ctrlKey && e.shiftKey && isTableBlock) {
                        // Zeile einfügen
                        if (currentBlock.tableGrid) {
                            this.blockManager.insertTableRow(currentBlock.id, currentBlock.tableGrid.rows);
                            new Notice('Row inserted');
                            e.preventDefault();
                        }
                    }
                    break;

                case 'c':
                case 'C':
                    if (e.ctrlKey && e.shiftKey && isTableBlock) {
                        // Spalte einfügen
                        if (currentBlock.tableGrid) {
                            this.blockManager.insertTableColumn(currentBlock.id, currentBlock.tableGrid.cols);
                            new Notice('Column inserted');
                            e.preventDefault();
                        }
                    }
                    break;

                case 'm':
                case 'M':
                    if (e.ctrlKey && e.shiftKey && isTableBlock) {
                        // Tabellen-Modus umschalten
                        const nextMode = tableToolMode === 'move-line' ? 'merge-cells' :
                            tableToolMode === 'merge-cells' ? null : 'move-line';
                        this.blockManager.setTableToolMode(nextMode);

                        if (nextMode === 'move-line') {
                            new Notice('Table line move mode - click and drag lines to adjust');
                        } else if (nextMode === 'merge-cells') {
                            new Notice('Table merge mode - click two cells to merge them');
                        } else {
                            new Notice('Table edit mode exited');
                        }
                        e.preventDefault();
                    }
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

                case 'd':
                case 'D':
                    if (e.ctrlKey) {
                        this.digitalizationManager.digitalizeCurrentDocument();
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
        this.blocksContainer = null;

        // Neues Dokument laden
        await this.loadDocument();

        // UI neu aufbauen
        await this.setupUI();

        // Scroll positionieren
        if (this.blocksContainer) {
            (this.blocksContainer as HTMLElement).scrollTop = 0;
        }

        // Tabellen-Tools aktualisieren
        setTimeout(() => {
            this.toolbarManager.updateTableToolsVisibility();
        }, 100);
    }

    async loadDocument(): Promise<void> {
        if (!this.file) {
            this.document = new InkDocument();
            return;
        }

        try {
            const raw = await this.app.vault.read(this.file);
            this.document = raw ? new InkDocument(JSON.parse(raw)) : new InkDocument();

            if (this.document) {
                this.blocks = [...this.document.blocks].sort((a, b) => a.order - b.order);
            }
        } catch (error) {
            console.error('Error loading document:', error);
            this.document = new InkDocument();
        }
    }

    async saveDocument(): Promise<void> {
        if (!this.document || !this.file) {
            console.error('❌ No document or file to save');
            new Notice('No document to save');
            return;
        }

        try {
            console.log('💾 Saving document...');

            const docData = this.document.getData();
            docData.blocks = this.blocks.map(block => ({
                ...block,
                strokeIds: [...block.strokeIds]
            })).sort((a, b) => a.order - b.order);

            const usedStrokeIds = new Set<string>();
            docData.blocks.forEach(block => {
                block.strokeIds.forEach(id => usedStrokeIds.add(id));
            });

            docData.strokes = docData.strokes.filter(stroke =>
                usedStrokeIds.has(stroke.id)
            );

            this.document = new InkDocument(docData);
            await this.app.vault.modify(this.file, JSON.stringify(docData, null, 2));

            console.log('✅ Document saved successfully');
            new Notice('Document saved');

        } catch (error) {
            console.error('❌ Failed to save document:', error);
            new Notice(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
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