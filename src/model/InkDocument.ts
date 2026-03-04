import { InkDocumentData, Stroke, Block, Point, StrokeStyle, GridSettings } from '../types';
import { CubicBezier } from '../bezierFitting';

// ─── Serialisierungsformat v2 ─────────────────────────────────────────────────
// Punkte werden als Base64-kodierte Float32-Folge gespeichert (2 floats/Punkt).
// BezierCurves als Base64-kodierte Float32-Folge (8 floats/Kurve: p0p1p2p3, je x,y).
interface SerializedStroke {
    id: string;
    pts: string;        // base64: Float32Array [x0,y0, x1,y1, ...]
    bez?: string;       // base64: Float32Array [p0x,p0y, p1x,p1y, p2x,p2y, p3x,p3y, ...]
    style: StrokeStyle;
}

interface SerializedDocumentData {
    schemaVersion: number;
    document: InkDocumentData['document'];
    strokes: SerializedStroke[];
    blocks: Block[];
    settings: InkDocumentData['settings'];
    metadata: Record<string, any>;
}

// ─── Binär-Hilfsfunktionen ────────────────────────────────────────────────────

function encodePoints(points: Point[]): string {
    const buf = new Float32Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
        buf[i * 2]     = points[i]!.x;
        buf[i * 2 + 1] = points[i]!.y;
    }
    return float32ToBase64(buf);
}

function decodePoints(encoded: string): Point[] {
    const buf = base64ToFloat32(encoded);
    const count = Math.floor(buf.length / 2);
    const points: Point[] = [];
    for (let i = 0; i < count; i++) {
        points.push({ x: buf[i * 2]!, y: buf[i * 2 + 1]! });
    }
    return points;
}

function encodeBeziers(curves: CubicBezier[]): string {
    const buf = new Float32Array(curves.length * 8);
    for (let i = 0; i < curves.length; i++) {
        const b = curves[i]!;
        const base = i * 8;
        buf[base]     = b.p0.x; buf[base + 1] = b.p0.y;
        buf[base + 2] = b.p1.x; buf[base + 3] = b.p1.y;
        buf[base + 4] = b.p2.x; buf[base + 5] = b.p2.y;
        buf[base + 6] = b.p3.x; buf[base + 7] = b.p3.y;
    }
    return float32ToBase64(buf);
}

function decodeBeziers(encoded: string): CubicBezier[] {
    const buf = base64ToFloat32(encoded);
    const count = Math.floor(buf.length / 8);
    const curves: CubicBezier[] = [];
    for (let i = 0; i < count; i++) {
        const base = i * 8;
        curves.push({
            p0: { x: buf[base]!,     y: buf[base + 1]! },
            p1: { x: buf[base + 2]!, y: buf[base + 3]! },
            p2: { x: buf[base + 4]!, y: buf[base + 5]! },
            p3: { x: buf[base + 6]!, y: buf[base + 7]! },
        });
    }
    return curves;
}

function float32ToBase64(arr: Float32Array): string {
    // Float32Array → Uint8Array (gleicher Puffer, little-endian auf LE-Maschinen)
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    let binary = '';
    // 1024 Bytes auf einmal — vermeidet Stack-Overflow bei fromCharCode.apply
    for (let i = 0; i < bytes.length; i += 1024) {
        binary += String.fromCharCode(...(bytes.subarray(i, i + 1024) as unknown as number[]));
    }
    return btoa(binary);
}

function base64ToFloat32(b64: string): Float32Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // Float32Array-View über denselben Puffer — kein Kopieren
    return new Float32Array(bytes.buffer);
}

// ─── InkDocument ─────────────────────────────────────────────────────────────

export class InkDocument {
    private data: InkDocumentData;
    private _strokeMap = new Map<string, Stroke>();

    constructor(data?: Partial<InkDocumentData>) {
        const now = new Date().toISOString();
        const defaultData: InkDocumentData = {
            schemaVersion: 2,
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
                defaultPen: { width: 2.0, color: '#000000', semantic: 'normal' },
                smoothing: 0.3
            },
            metadata: { createdWith: 'VectorInk Plugin v1.0' }
        };

        if (data && data.document) {
            const mergedGrid = { ...defaultData.document.grid, ...(data.document.grid || {}) };
            this.data = {
                ...defaultData, ...data,
                document: { ...defaultData.document, ...data.document, grid: mergedGrid }
            };
        } else {
            this.data = { ...defaultData, ...data };
        }

        for (const stroke of this.data.strokes) {
            this._strokeMap.set(stroke.id, stroke);
        }
    }

    get strokes(): Stroke[] { return [...this.data.strokes]; }
    get blocks(): Block[]   { return [...this.data.blocks]; }
    get gridSettings(): GridSettings { return this.data.document.grid; }

    setGridSettings(settings: Partial<GridSettings>): void {
        this.data.document.grid = { ...this.data.document.grid, ...settings };
        this.updateTimestamp();
    }

    getData(): InkDocumentData { return { ...this.data }; }

    addStroke(stroke: Omit<Stroke, 'id'>): Stroke {
        const newStroke: Stroke = { ...stroke, id: crypto.randomUUID() };
        this.data.strokes.push(newStroke);
        this._strokeMap.set(newStroke.id, newStroke);
        this.updateTimestamp();
        return newStroke;
    }

    addBlock(block: Block): void {
        const idx = this.data.blocks.findIndex(b => b.id === block.id);
        if (idx >= 0) this.data.blocks[idx] = block;
        else this.data.blocks.push(block);
        this.updateTimestamp();
    }

    removeBlock(blockId: string): void {
        this.data.blocks = this.data.blocks.filter(b => b.id !== blockId);
        this.updateTimestamp();
    }

    clearStrokes(): void {
        this.data.strokes = [];
        this._strokeMap.clear();
        this.updateTimestamp();
    }

    clearBlocks(): void {
        const ids = new Set<string>();
        this.data.blocks.forEach(b => b.strokeIds.forEach(id => ids.add(id)));
        ids.forEach(id => this.removeStroke(id));
        this.data.blocks = [];
        this.updateTimestamp();
    }

    removeStroke(strokeId: string): boolean {
        const idx = this.data.strokes.findIndex(s => s.id === strokeId);
        if (idx < 0) return false;
        this.data.strokes.splice(idx, 1);
        this._strokeMap.delete(strokeId);
        this.updateTimestamp();
        return true;
    }

    updateTimestamp(): void {
        this.data.document.updatedAt = new Date().toISOString();
    }

    getStroke(strokeId: string): Stroke | undefined {
        return this._strokeMap.get(strokeId);
    }

    getBlock(blockId: string): Block | undefined {
        return this.data.blocks.find(b => b.id === blockId);
    }

    updateStroke(strokeId: string, updates: Partial<Stroke>): boolean {
        const stroke = this._strokeMap.get(strokeId);
        if (!stroke) return false;
        const idx = this.data.strokes.indexOf(stroke);
        if (idx < 0) return false;
        const updated: Stroke = {
            id: strokeId,
            points: updates.points ?? stroke.points,
            bezierCurves: updates.bezierCurves ?? stroke.bezierCurves,
            style: updates.style ?? stroke.style,
        };
        this.data.strokes[idx] = updated;
        this._strokeMap.set(strokeId, updated);
        this.updateTimestamp();
        return true;
    }

    updateBlock(blockId: string, updates: Partial<Block>): boolean {
        const idx = this.data.blocks.findIndex(b => b.id === blockId);
        if (idx < 0) return false;
        const orig = this.data.blocks[idx]!;
        this.data.blocks[idx] = {
            id: blockId,
            type: updates.type ?? orig.type,
            strokeIds: updates.strokeIds ?? orig.strokeIds,
            bbox: updates.bbox ?? orig.bbox,
            order: updates.order ?? orig.order,
        };
        this.updateTimestamp();
        return true;
    }

    get pageSettings() { return this.data.document.page; }
    get settings()     { return this.data.settings; }

    // ─── Serialisierung ───────────────────────────────────────────────────────

    toJSON(): string {
        const serialized: SerializedDocumentData = {
            schemaVersion: 2,
            document: this.data.document,
            strokes: this.data.strokes.map(s => {
                const out: SerializedStroke = {
                    id: s.id,
                    pts: encodePoints(s.points),
                    style: s.style,
                };
                if (s.bezierCurves && s.bezierCurves.length > 0) {
                    out.bez = encodeBeziers(s.bezierCurves);
                }
                return out;
            }),
            blocks: this.data.blocks,
            settings: this.data.settings,
            metadata: this.data.metadata,
        };
        // Kompaktes JSON — kein Whitespace
        return JSON.stringify(serialized);
    }

    static fromJSON(json: string): InkDocument {
        const raw = JSON.parse(json);

        if (raw.schemaVersion === 2) {
            // v2: Strokes binär kodiert
            const strokes: Stroke[] = (raw.strokes as SerializedStroke[]).map(s => ({
                id: s.id,
                points: decodePoints(s.pts),
                bezierCurves: s.bez ? decodeBeziers(s.bez) : [],
                style: s.style,
            }));
            const data: InkDocumentData = {
                ...raw,
                strokes,
            };
            return new InkDocument(data);
        }

        // v1: Rückwärtskompatibilität — plain JSON-Objekte, Punkte haben ggf. t/pressure
        const strokes: Stroke[] = (raw.strokes ?? []).map((s: any) => ({
            id: s.id,
            points: (s.points ?? []).map((p: any) => ({ x: p.x, y: p.y })),
            bezierCurves: (s.bezierCurves ?? []).map((c: any) => ({
                p0: { x: c.p0.x, y: c.p0.y },
                p1: { x: c.p1.x, y: c.p1.y },
                p2: { x: c.p2.x, y: c.p2.y },
                p3: { x: c.p3.x, y: c.p3.y },
            })),
            style: s.style,
        }));
        return new InkDocument({ ...raw, strokes });
    }
}