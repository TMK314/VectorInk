// ink-schema.ts
export const SCHEMA_VERSION = 1;

export type Point = {
  x: number;
  y: number;
  t: number; // timestamp in ms
  pressure?: number; // 0-1, optional
  tiltX?: number; // -1 to 1, optional
  tiltY?: number; // -1 to 1, optional
};

export type StrokeStyle = {
  width: number; // in points (1/72 inch)
  color: string; // CSS color
  semantic?: 'normal' | 'bold' | 'italic' | 'highlight' | 'strike';
};

export type Stroke = {
  id: string; // UUID v4
  points: Point[];
  style: StrokeStyle;
  createdAt: string; // ISO timestamp
  device?: 'pen' | 'touch' | 'mouse';
};

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BlockType = 
  | 'paragraph'
  | 'heading'
  | 'quote'
  | 'math'
  | 'list'
  | 'table'
  | 'code'
  | 'divider';

export type Block = {
  id: string; // UUID v4
  type: BlockType;
  strokeIds: string[]; // references to stroke IDs
  bbox: BoundingBox;
  order: number; // rendering order
  metadata?: {
    level?: number; // for heading levels
    language?: string; // for code blocks
    listType?: 'bullet' | 'numbered' | 'checkbox';
  };
};

export type PageSettings = {
  width: number;
  height: number;
  unit: 'mm' | 'inch' | 'px';
  backgroundColor: string;
  grid?: {
    enabled: boolean;
    size: number;
    color: string;
  };
};

export type InkDocument = {
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
    smoothing: number; // 0-1
  };
  metadata: {
    author?: string;
    tags?: string[];
    ocrEngine?: string;
    ocrVersion?: string;
  };
};

// JSON Schema Validation (Draft-07)
export const INK_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Obsidian Ink Document",
  type: "object",
  required: ["schemaVersion", "document", "strokes", "blocks"],
  properties: {
    schemaVersion: {
      type: "integer",
      minimum: 1,
      maximum: 1
    },
    document: {
      type: "object",
      required: ["id", "createdAt", "page"],
      properties: {
        id: { type: "string", format: "uuid" },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
        page: {
          type: "object",
          required: ["width", "height", "unit"],
          properties: {
            width: { type: "number", minimum: 0 },
            height: { type: "number", minimum: 0 },
            unit: { enum: ["mm", "inch", "px"] },
            backgroundColor: { type: "string", pattern: "^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$" },
            grid: {
              type: "object",
              properties: {
                enabled: { type: "boolean" },
                size: { type: "number", minimum: 1 },
                color: { type: "string" }
              }
            }
          }
        }
      }
    },
    strokes: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "points", "style", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          points: {
            type: "array",
            items: {
              type: "object",
              required: ["x", "y", "t"],
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                t: { type: "number" },
                pressure: { type: "number", minimum: 0, maximum: 1 },
                tiltX: { type: "number", minimum: -1, maximum: 1 },
                tiltY: { type: "number", minimum: -1, maximum: 1 }
              }
            }
          },
          style: {
            type: "object",
            required: ["width", "color"],
            properties: {
              width: { type: "number", minimum: 0.1 },
              color: { type: "string" },
              semantic: { enum: ["normal", "bold", "italic", "highlight", "strike"] }
            }
          },
          createdAt: { type: "string", format: "date-time" },
          device: { enum: ["pen", "touch", "mouse"] }
        }
      }
    },
    blocks: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "type", "strokeIds", "bbox", "order"],
        properties: {
          id: { type: "string", format: "uuid" },
          type: { 
            enum: ["paragraph", "heading", "quote", "math", "list", "table", "code", "divider"]
          },
          strokeIds: {
            type: "array",
            items: { type: "string", format: "uuid" }
          },
          bbox: {
            type: "object",
            required: ["x", "y", "width", "height"],
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number", minimum: 0 },
              height: { type: "number", minimum: 0 }
            }
          },
          order: { type: "integer", minimum: 0 },
          metadata: {
            type: "object",
            properties: {
              level: { type: "integer", minimum: 1, maximum: 6 },
              language: { type: "string" },
              listType: { enum: ["bullet", "numbered", "checkbox"] }
            }
          }
        }
      }
    }
  }
};