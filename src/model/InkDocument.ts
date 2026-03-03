import { InkDocumentData, Stroke, Block, Point, StrokeStyle, GridSettings } from '../types';

export class InkDocument {
    private data: InkDocumentData;

    constructor(data?: Partial<InkDocumentData>) {
        const now = new Date().toISOString();
        const defaultData: InkDocumentData = {
            schemaVersion: 1,
            document: {
                id: crypto.randomUUID(),
                createdAt: now,
                updatedAt: now,
                page: {
                    width: 210,
                    height: 297,
                    unit: 'mm',
                    backgroundColor: '#ffffff'
                },
                grid: {
                    enabled: false,
                    type: 'grid',
                    size: 20,
                    color: '#e0e0e0',
                    opacity: 0.5,
                    lineWidth: 0.5
                }
            },
            strokes: [],
            blocks: [],
            settings: {
                defaultPen: {
                    width: 2.0,
                    color: '#000000',
                    semantic: 'normal'
                },
                pressureSensitivity: true,
                smoothing: 0.3
            },
            metadata: {
                createdWith: 'VectorInk Plugin v1.0'
            }
        };

        // Tiefes Merging für Grid-Einstellungen
        if (data && data.document) {
            const mergedGrid = {
                ...defaultData.document.grid,
                ...(data.document.grid || {})
            };
            
            this.data = {
                ...defaultData,
                ...data,
                document: {
                    ...defaultData.document,
                    ...data.document,
                    grid: mergedGrid
                }
            };
        } else {
            this.data = { ...defaultData, ...data };
        }
    }

    // Getter for strokes (returns a copy)
    get strokes(): Stroke[] {
        return [...this.data.strokes];
    }

    // Getter for blocks (returns a copy)
    get blocks(): Block[] {
        return [...this.data.blocks];
    }

    get gridSettings(): GridSettings {
        return this.data.document.grid;
    }

    setGridSettings(settings: Partial<GridSettings>): void {
        this.data.document.grid = { ...this.data.document.grid, ...settings };
        this.updateTimestamp();
    }

    // Getter for data
    getData(): InkDocumentData {
        return { ...this.data };
    }

    // Method to add stroke
    addStroke(stroke: Omit<Stroke, 'id' | 'createdAt'>): Stroke {
        const newStroke: Stroke = {
            ...stroke,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString()
        };
        this.data.strokes.push(newStroke);
        this.updateTimestamp();
        return newStroke;
    }

    // Method to add block
    addBlock(block: Block): void {
        // Check if block already exists
        const existingIndex = this.data.blocks.findIndex(b => b.id === block.id);
        if (existingIndex >= 0) {
            // Update existing block
            this.data.blocks[existingIndex] = block;
        } else {
            // Add new block
            this.data.blocks.push(block);
        }
        this.updateTimestamp();
    }

    removeBlock(blockId: string): void {
        this.data.blocks = this.data.blocks.filter(b => b.id !== blockId);
        this.updateTimestamp();
    }

    // Clear all strokes
    clearStrokes(): void {
        this.data.strokes = []; // Direkt das data-Array leeren
        this.updateTimestamp();
    }

    // Clear all blocks
    clearBlocks(): void {
        // Alle Stroke-IDs aus allen Blöcken sammeln
        const allStrokeIds = new Set<string>();
        this.data.blocks.forEach(block => {
            block.strokeIds.forEach(id => allStrokeIds.add(id));
        });

        // Alle Strokes löschen, die zu Blöcken gehören
        allStrokeIds.forEach(strokeId => {
            this.removeStroke(strokeId);
        });

        // Blöcke leeren
        this.data.blocks = [];
        this.updateTimestamp();
    }

    removeStroke(strokeId: string): boolean {
        const index = this.data.strokes.findIndex(s => s.id === strokeId);
        if (index >= 0) {
            this.data.strokes.splice(index, 1);
            this.updateTimestamp();
            return true;
        }
        return false;
    }

    // Update timestamp
    updateTimestamp(): void {
        this.data.document.updatedAt = new Date().toISOString();
    }

    // Convert to JSON
    toJSON(): string {
        return JSON.stringify(this.data, null, 2);
    }

    // Create from JSON
    static fromJSON(json: string): InkDocument {
        const data = JSON.parse(json);
        return new InkDocument(data);
    }

    // Get stroke by ID
    getStroke(strokeId: string): Stroke | undefined {
        return this.data.strokes.find(s => s.id === strokeId);
    }

    // Get block by ID
    getBlock(blockId: string): Block | undefined {
        return this.data.blocks.find(b => b.id === blockId);
    }

    // Update stroke
    updateStroke(strokeId: string, updates: Partial<Stroke>): boolean {
        const index = this.data.strokes.findIndex(s => s.id === strokeId);
        if (index >= 0) {
            const originalStroke = this.data.strokes[index];
            if (!originalStroke) return false;

            // Create a new stroke object with updates
            const updatedStroke: Stroke = {
                id: strokeId,
                points: updates.points ?? originalStroke.points,
                bezierCurves: updates.bezierCurves ?? originalStroke.bezierCurves,
                style: updates.style ?? originalStroke.style,
                createdAt: updates.createdAt ?? originalStroke.createdAt,
            };

            this.data.strokes[index] = updatedStroke;
            this.updateTimestamp();
            return true;
        }
        return false;
    }

    // Update block
    updateBlock(blockId: string, updates: Partial<Block>): boolean {
        const index = this.data.blocks.findIndex(b => b.id === blockId);
        if (index >= 0) {
            const originalBlock = this.data.blocks[index];
            if (!originalBlock) return false;

            // Create a new block object with updates
            const updatedBlock: Block = {
                id: blockId,
                type: updates.type ?? originalBlock.type,
                strokeIds: updates.strokeIds ?? originalBlock.strokeIds,
                bbox: updates.bbox ?? originalBlock.bbox,
                order: updates.order ?? originalBlock.order,
            };

            this.data.blocks[index] = updatedBlock;
            this.updateTimestamp();
            return true;
        }
        return false;
    }

    // Get page settings
    get pageSettings() {
        return this.data.document.page;
    }

    // Get settings
    get settings() {
        return this.data.settings;
    }
}