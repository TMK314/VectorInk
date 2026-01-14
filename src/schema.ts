export interface Point {
  x: number;
  y: number;
  t: number; // timestamp in ms
  pressure?: number; // 0-1, optional
  tiltX?: number; // -1 to 1, optional
  tiltY?: number; // -1 to 1, optional
}

export interface StrokeStyle {
  width: number;
  color: string;
  semantic?: 'normal' | 'bold' | 'italic' | 'highlight' | 'strike';
}

export interface Stroke {
  id: string;
  points: Point[];
  style: StrokeStyle;
  createdAt: string;
  device?: 'pen' | 'touch' | 'mouse';
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BlockType = 
  | 'paragraph'
  | 'heading'
  | 'quote'
  | 'math'
  | 'list'
  | 'table'
  | 'code'
  | 'divider';

export interface Block {
  id: string;
  type: BlockType;
  strokeIds: string[];
  bbox: BoundingBox;
  order: number;
  metadata?: {
    level?: number;
    language?: string;
    listType?: 'bullet' | 'numbered' | 'checkbox';
  };
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

export interface InkDocument {
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