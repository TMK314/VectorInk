import { Stroke, Block, BlockDisplaySettings, StrokeStyle } from '../types';
import { InkView } from './InkView';

export type HistoryAction =
    | { type: 'ADD_STROKE'; blockId: string; stroke: Stroke }
    | { type: 'ERASE_STROKES'; blockId: string; strokes: Stroke[]; blockStrokeIdIndices: number[] }
    | { type: 'DELETE_STROKES'; entries: Array<{ blockId: string; stroke: Stroke; blockStrokeIdIndex: number }> }
    | { type: 'PASTE_STROKES'; blockId: string; strokes: Stroke[] }
    | { type: 'MOVE_STROKES'; blockId: string; strokeIds: string[]; dx: number; dy: number }
    | { type: 'RESTYLE_STROKES'; blockId: string; entries: Array<{ strokeId: string; oldStyle: StrokeStyle; newStyle: StrokeStyle }> }
    | { type: 'RESTYLE_BLOCK'; entries: Array<{ blockId: string; oldSettings: Partial<BlockDisplaySettings>; newSettings: Partial<BlockDisplaySettings> }> };

const MAX_HISTORY = 100;

export class HistoryManager {
    private context: InkView;
    private undoStack: HistoryAction[] = [];
    private redoStack: HistoryAction[] = [];

    constructor(context: InkView) {
        this.context = context;
    }

    push(action: HistoryAction): void {
        this.undoStack.push(action);
        if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
        this.redoStack = [];
        this.updateButtonStates();
    }

    undo(): void {
        const action = this.undoStack.pop();
        if (!action) return;
        this.applyReverse(action);
        this.redoStack.push(action);
        this.updateButtonStates();
    }

    redo(): void {
        const action = this.redoStack.pop();
        if (!action) return;
        this.applyForward(action);
        this.undoStack.push(action);
        this.updateButtonStates();
    }

    canUndo(): boolean { return this.undoStack.length > 0; }
    canRedo(): boolean { return this.redoStack.length > 0; }

    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.updateButtonStates();
    }

    private applyReverse(action: HistoryAction): void {
        const doc = this.context.document;
        if (!doc) return;

        switch (action.type) {
            case 'ADD_STROKE': {
                const block = this.context.blocks.find(b => b.id === action.blockId);
                if (!block) break;
                doc.removeStroke(action.stroke.id);
                block.strokeIds = block.strokeIds.filter(id => id !== action.stroke.id);
                this.invalidateAndRedraw(block);
                break;
            }
            case 'ERASE_STROKES': {
                const block = this.context.blocks.find(b => b.id === action.blockId);
                if (!block) break;

                const items = action.strokes.map((stroke, i) => ({
                    stroke,
                    idx: action.blockStrokeIdIndices[i] ?? block.strokeIds.length
                })).sort((a, b) => a.idx - b.idx);

                for (const { stroke, idx } of items) {
                    doc.restoreStroke({
                        ...stroke,
                        points: stroke.points.map(p => ({ ...p })),
                        bezierCurves: stroke.bezierCurves?.map(c => ({
                            ...c,
                            p0: { ...c.p0 },
                            p1: { ...c.p1 },
                            p2: { ...c.p2 },
                            p3: { ...c.p3 }
                        })),
                        style: { ...stroke.style }
                    });
                    block.strokeIds.splice(idx, 0, stroke.id);
                }

                // Cache hart ersetzen (wie DELETE)
                const sentinel = document.createElement('canvas');
                this.context.drawingManager['_strokeCache'].set(block.id, sentinel);

                const canvas = this.context.blockManager.getCanvasForBlock(block.id);
                if (canvas) {
                    this.context.drawingManager.renderBlockSync(canvas, block);
                }

                this.context.strokeSelectionManager.selectedStrokes.clear();
                break;
            }
            case 'DELETE_STROKES': {
                const grouped = new Map<string, Array<{ stroke: Stroke; idx: number }>>();
                for (const entry of action.entries) {
                    if (!grouped.has(entry.blockId)) grouped.set(entry.blockId, []);
                    grouped.get(entry.blockId)!.push({ stroke: entry.stroke, idx: entry.blockStrokeIdIndex });
                }
                for (const [blockId, items] of grouped) {
                    const block = this.context.blocks.find(b => b.id === blockId);
                    if (!block) continue;
                    items.sort((a, b) => a.idx - b.idx);
                    for (const { stroke, idx } of items) {
                        doc.restoreStroke({
                            ...stroke,
                            points: stroke.points.map(p => ({ ...p })),
                            bezierCurves: stroke.bezierCurves?.map(c => ({
                                ...c,
                                p0: { ...c.p0 },
                                p1: { ...c.p1 },
                                p2: { ...c.p2 },
                                p3: { ...c.p3 }
                            })),
                            style: { ...stroke.style }
                        });
                        block.strokeIds.splice(idx, 0, stroke.id);
                    }
                    // Sentinel setzt den Cache, damit alle laufenden Idle-Callbacks ungültig werden
                    const sentinel = document.createElement('canvas');
                    this.context.drawingManager['_strokeCache'].set(block.id, sentinel);

                    const canvas = this.context.blockManager.getCanvasForBlock(block.id);
                    if (canvas) {
                        this.context.drawingManager.renderBlockSync(canvas, block);
                    }
                }
                this.context.strokeSelectionManager.selectedStrokes.clear();
                break;
            }
            case 'PASTE_STROKES': {
                const block = this.context.blocks.find(b => b.id === action.blockId);
                if (!block) break;
                for (const stroke of action.strokes) {
                    doc.removeStroke(stroke.id);
                    block.strokeIds = block.strokeIds.filter(id => id !== stroke.id);
                }
                this.invalidateAndRedraw(block);
                break;
            }
            case 'MOVE_STROKES': {
                const block = this.context.blocks.find(b => b.id === action.blockId);
                if (!block) break;
                for (const strokeId of action.strokeIds) {
                    const stroke = doc.getStroke(strokeId);
                    if (!stroke) continue;
                    doc.updateStroke(strokeId, {
                        points: stroke.points.map(p => ({ ...p, x: p.x - action.dx, y: p.y - action.dy })),
                        bezierCurves: stroke.bezierCurves?.map(c => ({
                            p0: { ...c.p0, x: c.p0.x - action.dx, y: c.p0.y - action.dy },
                            p1: { ...c.p1, x: c.p1.x - action.dx, y: c.p1.y - action.dy },
                            p2: { ...c.p2, x: c.p2.x - action.dx, y: c.p2.y - action.dy },
                            p3: { ...c.p3, x: c.p3.x - action.dx, y: c.p3.y - action.dy },
                        }))
                    });
                }
                this.invalidateAndRedraw(block);
                break;
            }
            case 'RESTYLE_STROKES': {
                const block = this.context.blocks.find(b => b.id === action.blockId);
                if (!block) break;
                for (const { strokeId, oldStyle } of action.entries) {
                    this.context.document?.updateStroke(strokeId, { style: { ...oldStyle } });
                }
                this.invalidateAndRedraw(block);
                break;
            }
            case 'RESTYLE_BLOCK': {
                for (const { blockId, oldSettings } of action.entries) {
                    const block = this.context.blocks.find(b => b.id === blockId);
                    if (!block) continue;
                    if (!block.displaySettings) {
                        block.displaySettings = {
                            grid: { enabled: false, type: 'grid' as const, size: 20, color: '#e0e0e0', opacity: 0.5, lineWidth: 0.5 },
                            useColor: true, widthMultiplier: 1.0, backgroundColor: '#ffffff'
                        };
                    }
                    Object.assign(block.displaySettings, oldSettings);
                    this.invalidateAndRedraw(block);
                }
                this.context.drawingManager.redrawAllBlocks();
                this.context.toolbarManager.syncToolbarToCurrentBlock();
                break;
            }
        }
    }

    private applyForward(action: HistoryAction): void {
        const doc = this.context.document;
        if (!doc) return;

        switch (action.type) {
            case 'ADD_STROKE': {
                const block = this.context.blocks.find(b => b.id === action.blockId);
                if (!block) break;
                doc.restoreStroke(action.stroke);
                block.strokeIds.push(action.stroke.id);
                this.invalidateAndRedraw(block);
                break;
            }
            case 'ERASE_STROKES': {
                const block = this.context.blocks.find(b => b.id === action.blockId);
                if (!block) break;

                for (const stroke of action.strokes) {
                    doc.removeStroke(stroke.id);
                    block.strokeIds = block.strokeIds.filter(id => id !== stroke.id);
                }

                const sentinel = document.createElement('canvas');
                this.context.drawingManager['_strokeCache'].set(block.id, sentinel);

                const canvas = this.context.blockManager.getCanvasForBlock(block.id);
                if (canvas) {
                    this.context.drawingManager.renderBlockSync(canvas, block);
                }

                this.context.strokeSelectionManager.selectedStrokes.clear();
                break;
            }

            case 'DELETE_STROKES': {
                const blockIds = new Set(action.entries.map(e => e.blockId));
                for (const blockId of blockIds) {
                    const block = this.context.blocks.find(b => b.id === blockId);
                    if (!block) continue;
                    for (const { stroke } of action.entries.filter(e => e.blockId === blockId)) {
                        doc.removeStroke(stroke.id);
                        block.strokeIds = block.strokeIds.filter(id => id !== stroke.id);
                    }
                    // Alten Cache sofort ersetzen – laufende Idle-Callbacks sehen einen anderen
                    // capturedCache und zeichnen nicht mehr auf den Canvas.
                    const sentinel = document.createElement('canvas');
                    this.context.drawingManager['_strokeCache'].set(block.id, sentinel);

                    const canvas = this.context.blockManager.getCanvasForBlock(block.id);
                    if (canvas) {
                        this.context.drawingManager.renderBlockSync(canvas, block);
                    }
                }
                this.context.strokeSelectionManager.selectedStrokes.clear();
                break;
            }
            case 'PASTE_STROKES': {
                const block = this.context.blocks.find(b => b.id === action.blockId);
                if (!block) break;
                for (const stroke of action.strokes) {
                    doc.restoreStroke({
                        ...stroke,
                        points: stroke.points.map(p => ({ ...p })),
                        bezierCurves: stroke.bezierCurves?.map(c => ({
                            ...c,
                            p0: { ...c.p0 },
                            p1: { ...c.p1 },
                            p2: { ...c.p2 },
                            p3: { ...c.p3 }
                        })),
                        style: { ...stroke.style }
                    });
                    block.strokeIds.push(stroke.id);
                }
                this.invalidateAndRedraw(block);
                break;
            }
            case 'MOVE_STROKES': {
                const block = this.context.blocks.find(b => b.id === action.blockId);
                if (!block) break;
                for (const strokeId of action.strokeIds) {
                    const stroke = doc.getStroke(strokeId);
                    if (!stroke) continue;
                    doc.updateStroke(strokeId, {
                        points: stroke.points.map(p => ({ ...p, x: p.x + action.dx, y: p.y + action.dy })),
                        bezierCurves: stroke.bezierCurves?.map(c => ({
                            p0: { ...c.p0, x: c.p0.x + action.dx, y: c.p0.y + action.dy },
                            p1: { ...c.p1, x: c.p1.x + action.dx, y: c.p1.y + action.dy },
                            p2: { ...c.p2, x: c.p2.x + action.dx, y: c.p2.y + action.dy },
                            p3: { ...c.p3, x: c.p3.x + action.dx, y: c.p3.y + action.dy },
                        }))
                    });
                }
                this.invalidateAndRedraw(block);
                break;
            }
            case 'RESTYLE_STROKES': {
                const block = this.context.blocks.find(b => b.id === action.blockId);
                if (!block) break;
                for (const { strokeId, newStyle } of action.entries) {
                    this.context.document?.updateStroke(strokeId, { style: { ...newStyle } });
                }
                this.invalidateAndRedraw(block);
                break;
            }
            case 'RESTYLE_BLOCK': {
                for (const { blockId, newSettings } of action.entries) {
                    const block = this.context.blocks.find(b => b.id === blockId);
                    if (!block) continue;
                    if (!block.displaySettings) {
                        block.displaySettings = {
                            grid: { enabled: false, type: 'grid' as const, size: 20, color: '#e0e0e0', opacity: 0.5, lineWidth: 0.5 },
                            useColor: true, widthMultiplier: 1.0, backgroundColor: '#ffffff'
                        };
                    }
                    Object.assign(block.displaySettings, newSettings);
                    this.invalidateAndRedraw(block);
                }
                this.context.drawingManager.redrawAllBlocks();
                this.context.toolbarManager.syncToolbarToCurrentBlock();
                break;
            }
        }
    }

    private invalidateAndRedraw(block: Block): void {
        this.context.drawingManager.invalidateBlockCache(block.id);
        const canvas = this.context.blockManager.getCanvasForBlock(block.id);
        if (canvas) {
            this.context.drawingManager.renderBlockSync(canvas, block);
        }
    }

    private updateButtonStates(): void {
        this.context.toolbarManager.updateUndoRedoButtons(this.canUndo(), this.canRedo());
    }
}