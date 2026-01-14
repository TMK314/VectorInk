import { InkDocumentData, Stroke, Block, Point, StrokeStyle } from '../types';

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

    this.data = { ...defaultData, ...data };
  }

  // Getter for strokes (returns a copy)
  get strokes(): Stroke[] {
    return [...this.data.strokes];
  }

  // Getter for blocks (returns a copy)
  get blocks(): Block[] {
    return [...this.data.blocks];
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
  addBlock(block: Omit<Block, 'id'>): Block {
    const newBlock: Block = {
      ...block,
      id: crypto.randomUUID()
    };
    this.data.blocks.push(newBlock);
    this.updateTimestamp();
    return newBlock;
  }

  // Clear all strokes
  clearStrokes(): void {
    this.data.strokes = [];
    this.updateTimestamp();
  }

  // Clear all blocks
  clearBlocks(): void {
    this.data.blocks = [];
    this.updateTimestamp();
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

  // Get page settings
  get pageSettings() {
    return this.data.document.page;
  }

  // Get settings
  get settings() {
    return this.data.settings;
  }
}