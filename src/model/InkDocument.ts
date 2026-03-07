import { InkDocumentData, Stroke, Block, Point, StrokeStyle, GridSettings, BlockDisplaySettings } from '../types';
import { CubicBezier } from '../bezierFitting';

// ─── Kurz-ID-System ───────────────────────────────────────────────────────────
// Alle druckbaren ASCII-Zeichen außer " (0x22) und \ (0x5C) → 92 Zeichen.
// Basis-92-Kodierung eines monoton steigenden Zählers.
// 1 Zeichen: 92 IDs | 2 Zeichen: 8.464 | 3 Zeichen: 778.688
const ID_ALPHA = (() => {
    let s = '';
    for (let c = 0x21; c <= 0x7E; c++) {
        if (c === 0x22 || c === 0x5C) continue; // " und \ ausschließen
        s += String.fromCharCode(c);
    }
    return s; // 92 Zeichen
})();
const ID_BASE = ID_ALPHA.length; // 92

function encodeId(n: number): string {
    if (n < 0) throw new Error('ID counter must be >= 0');
    if (n === 0) return ID_ALPHA[0]!;
    let result = '';
    while (n > 0) {
        result = ID_ALPHA[n % ID_BASE]! + result;
        n = Math.floor(n / ID_BASE);
    }
    return result;
}

function decodeId(s: string): number {
    let n = 0;
    for (const ch of s) {
        const idx = ID_ALPHA.indexOf(ch);
        if (idx === -1) return NaN;
        n = n * ID_BASE + idx;
    }
    return n;
}

// ─── Serialisierungsformat v2 ─────────────────────────────────────────────────
// Stroke-Punkte: Base64-kodierter Float32Array [x0,y0, x1,y1, ...]
// Bézierkurven:  Base64-kodierter Float32Array [p0x,p0y, p1x,p1y, p2x,p2y, p3x,p3y, ...]
interface SerializedStroke {
    id: string;
    pts: string;
    bez?: string;
    style: StrokeStyle;
}

interface SerializedDocumentData {
    schemaVersion: 2;
    _c: number; // ID-Zählerstand
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
        buf[i * 2] = points[i]!.x;
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
        const o = i * 8;
        buf[o] = b.p0.x; buf[o + 1] = b.p0.y;
        buf[o + 2] = b.p1.x; buf[o + 3] = b.p1.y;
        buf[o + 4] = b.p2.x; buf[o + 5] = b.p2.y;
        buf[o + 6] = b.p3.x; buf[o + 7] = b.p3.y;
    }
    return float32ToBase64(buf);
}

function decodeBeziers(encoded: string): CubicBezier[] {
    const buf = base64ToFloat32(encoded);
    const count = Math.floor(buf.length / 8);
    const curves: CubicBezier[] = [];
    for (let i = 0; i < count; i++) {
        const o = i * 8;
        curves.push({
            p0: { x: buf[o]!, y: buf[o + 1]! },
            p1: { x: buf[o + 2]!, y: buf[o + 3]! },
            p2: { x: buf[o + 4]!, y: buf[o + 5]! },
            p3: { x: buf[o + 6]!, y: buf[o + 7]! },
        });
    }
    return curves;
}

function float32ToBase64(arr: Float32Array): string {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1024) {
        binary += String.fromCharCode(...(bytes.subarray(i, i + 1024) as unknown as number[]));
    }
    return btoa(binary);
}

function base64ToFloat32(b64: string): Float32Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Float32Array(bytes.buffer);
}

// ─── InkDocument ─────────────────────────────────────────────────────────────

export class InkDocument {
    private data: InkDocumentData;
    private _strokeMap = new Map<string, Stroke>();
    private _idCounter = 0;

    constructor(data?: Partial<InkDocumentData>, idCounter = 0) {
        const now = new Date().toISOString();
        const defaultData: InkDocumentData = {
            schemaVersion: 2,
            document: {
                id: crypto.randomUUID(),
                createdAt: now,
                updatedAt: now,
                page: { width: 210, height: 297, unit: 'mm', backgroundColor: '#ffffff' },
                grid: { enabled: false, type: 'grid', size: 20, color: '#e0e0e0', opacity: 0.5, lineWidth: 0.5 }
            },
            strokes: [],
            blocks: [],
            settings: { defaultPen: { width: 2.0, color: '#000000', semantic: 'normal' }, smoothing: 0.3 },
            metadata: { createdWith: 'VectorInk Plugin v1.0' }
        };

        if (data?.document) {
            const mergedGrid = { ...defaultData.document.grid, ...(data.document.grid ?? {}) };
            this.data = { ...defaultData, ...data, document: { ...defaultData.document, ...data.document, grid: mergedGrid } };
        } else {
            this.data = { ...defaultData, ...data };
        }

        this._idCounter = idCounter;
        for (const stroke of this.data.strokes) {
            this._strokeMap.set(stroke.id, stroke);
        }
    }

    /** Gibt die nächste freie kurze ID zurück und inkrementiert den Zähler. */
    nextId(): string {
        return encodeId(this._idCounter++);
    }

    get idCounter(): number { return this._idCounter; }

    get strokes(): Stroke[] { return [...this.data.strokes]; }
    get blocks(): Block[] { return [...this.data.blocks]; }
    get gridSettings(): GridSettings { return this.data.document.grid; }

    setGridSettings(settings: Partial<GridSettings>): void {
        this.data.document.grid = { ...this.data.document.grid, ...settings };
        this.updateTimestamp();
    }

    getData(): InkDocumentData { return { ...this.data }; }

    addStroke(stroke: Omit<Stroke, 'id'>): Stroke {
        const newStroke: Stroke = { ...stroke, id: this.nextId() };
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

    getStroke(strokeId: string): Stroke | undefined { return this._strokeMap.get(strokeId); }
    getBlock(blockId: string): Block | undefined { return this.data.blocks.find(b => b.id === blockId); }

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
    get settings() { return this.data.settings; }

    // ─── Serialisierung ───────────────────────────────────────────────────────

    toJSON(): string {
        // Metadaten-Block (alles außer strokes/blocks) einzeilig
        const header: Omit<SerializedDocumentData, 'strokes' | 'blocks'> = {
            schemaVersion: 2,
            _c: this._idCounter,
            document: this.data.document,
            settings: this.data.settings,
            metadata: this.data.metadata,
        };

        // Jeder Stroke eine eigene Zeile → git-freundliche Diffs
        const strokeLines = this.data.strokes.map(s => {
            const entry: SerializedStroke = { id: s.id, pts: encodePoints(s.points), style: s.style };
            if (s.bezierCurves && s.bezierCurves.length > 0) entry.bez = encodeBeziers(s.bezierCurves);
            return JSON.stringify(entry);
        });

        // Jeder Block eine eigene Zeile
        const blockLines = this.data.blocks.map(b => JSON.stringify(b));

        const headerJson = JSON.stringify(header);
        // headerJson endet mit "}" — wir öffnen strokes/blocks als separate Sektionen
        const base = headerJson.slice(0, -1); // abschließende } entfernen

        const strokesSection = strokeLines.length === 0
            ? '"strokes":[]'
            : `"strokes":[\n${strokeLines.join(',\n')}\n]`;

        const blocksSection = blockLines.length === 0
            ? '"blocks":[]'
            : `"blocks":[\n${blockLines.join(',\n')}\n]`;

        return `${base},${strokesSection},${blocksSection}}`;
    }

    static fromJSON(json: string): InkDocument {
        const raw = JSON.parse(json);

        if (raw.schemaVersion === 2) {
            const idCounter: number = typeof raw._c === 'number' ? raw._c : 0;
            const strokes: Stroke[] = (raw.strokes as SerializedStroke[]).map(s => ({
                id: s.id,
                points: decodePoints(s.pts),
                bezierCurves: s.bez ? decodeBeziers(s.bez) : [],
                style: s.style,
            }));
            return new InkDocument({ ...raw, strokes }, idCounter);
        }

        // v1: Rückwärtskompatibilität (UUID-IDs, Punkte als JSON-Objekte)
        const strokes: Stroke[] = (raw.strokes ?? []).map((s: any) => ({
            id: s.id,
            points: (s.points ?? []).map((p: any) => ({ x: Number(p.x), y: Number(p.y) })),
            bezierCurves: (s.bezierCurves ?? []).map((c: any) => ({
                p0: { x: c.p0.x, y: c.p0.y }, p1: { x: c.p1.x, y: c.p1.y },
                p2: { x: c.p2.x, y: c.p2.y }, p3: { x: c.p3.x, y: c.p3.y },
            })),
            style: s.style,
        }));
        // Zähler so setzen, dass keine Kollision mit bestehenden UUIDs entsteht
        // (UUIDs sind keine gültigen Kurz-IDs → _idCounter = 0 ist sicher)
        return new InkDocument({ ...raw, strokes }, 0);
    }

    /** Fügt einen Stroke mit seiner originalen ID zurück ein (für Undo/Redo). */
    restoreStroke(stroke: Stroke): void {
        if (this._strokeMap.has(stroke.id)) return;

        const restored: Stroke = {
            id: stroke.id,
            points: stroke.points.map(p => ({ ...p })),
            bezierCurves: stroke.bezierCurves?.map(c => ({
                p0: { ...c.p0 },
                p1: { ...c.p1 },
                p2: { ...c.p2 },
                p3: { ...c.p3 },
            })),
            style: { ...stroke.style }
        };

        this.data.strokes.push(restored);
        this._strokeMap.set(restored.id, restored);   // ← FEHLTE
        this.updateTimestamp();
    }
}