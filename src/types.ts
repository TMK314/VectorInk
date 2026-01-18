export interface Point {
    x: number;
    y: number;
    t: number; // timestamp
    pressure?: number;
}

export interface StrokeStyle {
    width: number;
    color: string;
    semantic?: 'normal' | 'bold' | 'italic' | 'highlight';
    opacity?: number;
}

export interface Stroke {
    id: string;
    points: Point[];
    style: StrokeStyle;
    createdAt: string;
}

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type BlockType = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'quote' | 'math' | 'drawing' | 'table';

export interface Block {
    id: string;
    type: BlockType;
    strokeIds: string[];
    bbox: BoundingBox;
    order: number;
}

export interface PageSettings {
    width: number;
    height: number;
    unit: 'mm' | 'inch' | 'px';
    backgroundColor: string;
    grid?: {
        enabled: boolean;
        size: number;
        color: string;
    };
}

export interface InkDocumentData {
    schemaVersion: number;
    document: {
        id: string;
        createdAt: string;
        updatedAt: string;
        page: PageSettings;
    };
    strokes: Stroke[];
    blocks: Block[];
    settings: {
        defaultPen: StrokeStyle;
        pressureSensitivity: boolean;
        smoothing: number;
    };
    metadata: Record<string, any>;
}

export interface DigitizationResult {
    markdown: string;
    blocks: Block[];
}

// Neue Types für die Digitalisierung
export interface DigitalizationOptions {
    epsilon: number;
    recognizeHandwriting: boolean;
    formatOutput: boolean;
}

export interface BlockMetadata {
    id: string;
    type: BlockType;
    format: 'normal' | 'bold' | 'italic';
    recognizedText?: string;
    confidence?: number;
}

// Helper type for partial updates
export type PartialBlock = Partial<Block> & { id: string };