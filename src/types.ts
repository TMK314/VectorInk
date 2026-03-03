import { CubicBezier } from "bezierFitting";

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
    bezierCurves?: CubicBezier[];
    style: StrokeStyle;
    createdAt: string;
}

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type BlockType = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'quote' | 'math' | 'drawing';

export interface Block {
    id: string;
    type: BlockType;
    strokeIds: string[];
    bbox: BoundingBox;
    order: number;
    textContent?: string;
    textContentChanged?: boolean;
    displaySettings?: BlockDisplaySettings;
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
        grid: GridSettings;
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

// Helper type for partial updates
export type PartialBlock = Partial<Block> & { id: string };

export interface StrokeSelection {
  strokeIds: string[];
  boundingBox: BoundingBox;
}

export interface StrokeManipulationState {
  isSelecting: boolean;
  selectedStrokes: Set<string>;
  isDragging: boolean;
  dragOffset: Point;
  copiedStrokes: Stroke[];
}

export interface GridSettings {
    enabled: boolean;
    type: 'grid' | 'lines' | 'dots' | 'none';
    size: number;
    color: string;
    opacity: number;
    lineWidth: number; // Dicke der Grid-Linien/Punkte
}

export interface BlockDisplaySettings {
    grid: GridSettings;
    useColor: boolean;
    widthMultiplier: number;
    /** Hintergrundfarbe des Blocks. Wird nur verwendet wenn useColor === false. */
    backgroundColor?: string;
}