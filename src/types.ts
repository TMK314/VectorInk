export interface Point {
  x: number;
  y: number;
  t: number; // timestamp
  pressure?: number;
}

export interface StrokeStyle {
  width: number;
  color: string;
  semantic?: 'normal' | 'bold' | 'highlight';
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

export type BlockType = 'paragraph' | 'heading' | 'quote' | 'math';

export interface Block {
  id: string;
  type: BlockType;
  strokeIds: string[];
  bbox: BoundingBox;
  order: number;
  // metadata ist optional - entfernen oder mit ? markieren
  metadata?: {
    level?: number;
    language?: string;
    listType?: 'bullet' | 'numbered' | 'checkbox';
  };
}

// In types.ts
export interface PageSettings {
  width: number;
  height: number;
  unit: 'mm' | 'inch' | 'px';
  backgroundColor: string;
  grid?: {  // Optional property
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

// Simple result interface for digitization
export interface DigitizationResult {
  markdown: string;
  blocks: Block[];
}