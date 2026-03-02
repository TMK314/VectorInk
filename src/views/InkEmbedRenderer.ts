// views/InkEmbedRenderer.ts
import { TFile } from 'obsidian';
import VectorInkPlugin from '../main';
import { InkDocument } from '../model/InkDocument';
import { Stroke } from '../types';

/**
 * Renders a .ink file as a read-only SVG embed inside a Markdown note.
 * Double-click or "Edit"-button opens the full InkView editor.
 */
export class InkEmbedRenderer {
    private plugin: VectorInkPlugin;
    private container: HTMLElement;
    private file: TFile;

    constructor(plugin: VectorInkPlugin, container: HTMLElement, file: TFile) {
        this.plugin = plugin;
        this.container = container;
        this.file = file;
    }

    async render(): Promise<void> {
        this.container.empty();
        this.container.addClass('ink-embed');

        // Dokument laden
        let inkDoc: InkDocument;
        try {
            const raw = await this.plugin.app.vault.read(this.file);
            inkDoc = raw ? new InkDocument(JSON.parse(raw)) : new InkDocument();
        } catch (e) {
            this.container.createEl('p', {
                cls: 'ink-embed-error',
                text: `⚠ Could not load ${this.file.basename}: ${e}`,
            });
            return;
        }

        // Header mit Dateiname und Edit-Button
        const header = this.container.createDiv({ cls: 'ink-embed-header' });
        header.createSpan({ cls: 'ink-embed-title', text: this.file.basename });

        const editBtn = header.createEl('button', { cls: 'ink-embed-edit-btn', text: '✏ Edit' });
        editBtn.addEventListener('click', () => this.openInEditor());

        // SVG-Canvas
        const canvasWrapper = this.container.createDiv({ cls: 'ink-embed-canvas' });
        canvasWrapper.title = 'Double-click to edit';
        canvasWrapper.addEventListener('dblclick', () => this.openInEditor());

        this.renderSVG(canvasWrapper, inkDoc);
    }

    private renderSVG(wrapper: HTMLElement, inkDoc: InkDocument): void {
        const strokes: Stroke[] = inkDoc.strokes ?? [];

        // Bounding box über alle Strokes berechnen
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const stroke of strokes) {
            for (const p of stroke.points) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            }
        }

        // Fallback auf Page-Größe wenn keine Strokes vorhanden
        const pageW = inkDoc.pageSettings?.width ?? 800;
        const pageH = inkDoc.pageSettings?.height ?? 600;
        if (!isFinite(minX)) { minX = 0; minY = 0; maxX = pageW; maxY = pageH; }

        const pad = 16;
        const vbX = minX - pad;
        const vbY = minY - pad;
        const vbW = (maxX - minX) + pad * 2;
        const vbH = (maxY - minY) + pad * 2;

        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
        svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.width = '100%';
        svg.style.maxHeight = '400px';
        svg.style.display = 'block';

        // Hintergrund
        const bg = document.createElementNS(ns, 'rect');
        bg.setAttribute('x', String(vbX));
        bg.setAttribute('y', String(vbY));
        bg.setAttribute('width', String(vbW));
        bg.setAttribute('height', String(vbH));
        bg.setAttribute('fill', inkDoc.pageSettings?.backgroundColor ?? '#ffffff');
        svg.appendChild(bg);

        for (const stroke of strokes) {
            this.appendStrokePath(svg, stroke, ns);
        }

        wrapper.appendChild(svg);
    }

    private appendStrokePath(svg: SVGSVGElement, stroke: Stroke, ns: string): void {
        if (stroke.points.length < 2) return;

        const path = document.createElementNS(ns, 'path') as SVGPathElement;

        // Bezier-Kurven bevorzugen, Fallback auf einfache Liniensegmente
        if (stroke.bezierCurves && stroke.bezierCurves.length > 0) {
            let d = `M ${stroke.bezierCurves[0]!.p0.x} ${stroke.bezierCurves[0]!.p0.y}`;
            for (const c of stroke.bezierCurves) {
                d += ` C ${c.p1.x} ${c.p1.y}, ${c.p2.x} ${c.p2.y}, ${c.p3.x} ${c.p3.y}`;
            }
            path.setAttribute('d', d);
        } else {
            const pts = stroke.points;
            let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
            for (let i = 1; i < pts.length; i++) d += ` L ${pts[i]!.x} ${pts[i]!.y}`;
            path.setAttribute('d', d);
        }

        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', stroke.style.color ?? '#000000');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');

        if (stroke.style.semantic === 'highlight') {
            path.setAttribute('stroke-width', String((stroke.style.width ?? 2) * 3));
            path.setAttribute('stroke-opacity', '0.35');
        } else {
            path.setAttribute('stroke-width', String(stroke.style.width ?? 2));
            if (stroke.style.opacity !== undefined && stroke.style.opacity !== 1) {
                path.setAttribute('opacity', String(stroke.style.opacity));
            }
        }

        svg.appendChild(path);
    }

    private async openInEditor(): Promise<void> {
        const leaf = this.plugin.app.workspace.getLeaf('tab');
        await leaf.openFile(this.file);
    }
}