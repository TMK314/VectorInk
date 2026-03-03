// views/InkEmbedRenderer.ts
import { MarkdownRenderChild, TFile, Notice } from 'obsidian';
import VectorInkPlugin from '../main';
import { InkDocument } from '../model/InkDocument';
import { Block, BlockType, Point, Stroke, StrokeStyle, GridSettings, BlockDisplaySettings } from '../types';
import { BezierCurveFitter } from 'bezierFitting';

type EmbedMode = 'preview' | 'edit';

/**
 * Eingebetteter .ink-Editor/Vorschau in Markdown-Notizen.
 * - Vorschau: SVG, Klick aktiviert Bearbeitung
 * - Bearbeitung: Toolbar + Canvas-Blöcke (nur nach unten erweiterbar)
 * - Speichert automatisch beim Verlassen (blur)
 */
export class InkEmbedRenderer extends MarkdownRenderChild {
    private plugin: VectorInkPlugin;
    private file: TFile;
    private inkDoc: InkDocument | null = null;
    private mode: EmbedMode = 'preview';

    // Edit-Mode State
    private blocks: Block[] = [];
    private currentBlockIndex = 0;
    private editContainer: HTMLElement | null = null;
    private toolbar: HTMLElement | null = null;
    private blocksContainer: HTMLElement | null = null;
    private currentTool: 'pen' | 'eraser' = 'pen';
    private currentPenStyle: StrokeStyle = {
        width: 2.0, color: '#000000', semantic: 'normal', opacity: 1.0
    };

    constructor(plugin: VectorInkPlugin, container: HTMLElement, file: TFile) {
        super(container);
        this.plugin = plugin;
        this.file = file;
    }

    async onload(): Promise<void> {
        await this.loadDocument();
        this.renderPreview();
    }

    // ─── Dokument laden / speichern ────────────────────────────────────────────

    private async loadDocument(): Promise<void> {
        try {
            const raw = await this.plugin.app.vault.read(this.file);
            this.inkDoc = raw ? new InkDocument(JSON.parse(raw)) : new InkDocument();
            this.blocks = this.inkDoc
                ? [...this.inkDoc.blocks].sort((a, b) => a.order - b.order)
                : [];
        } catch (e) {
            this.inkDoc = new InkDocument();
            this.blocks = [];
        }
    }

    private async saveDocument(): Promise<void> {
        if (!this.inkDoc) return;
        try {
            const data = this.inkDoc.getData();
            data.blocks = this.blocks.map((b, i) => ({ ...b, order: i }));
            const usedIds = new Set(data.blocks.flatMap(b => b.strokeIds));
            data.strokes = data.strokes.filter(s => usedIds.has(s.id));
            this.inkDoc = new InkDocument(data);
            await this.plugin.app.vault.modify(this.file, JSON.stringify(data, null, 2));
        } catch (e) {
            new Notice('Ink: Speichern fehlgeschlagen');
        }
    }

    // ─── Vorschau-Modus ────────────────────────────────────────────────────────

    private renderPreview(): void {
        this.containerEl.empty();
        this.containerEl.addClass('ink-embed');
        this.containerEl.removeClass('ink-embed--edit');

        const svgWrapper = this.containerEl.createDiv({ cls: 'ink-embed-preview' });
        svgWrapper.title = 'Klicken zum Bearbeiten';

        if (!this.inkDoc || this.blocks.length === 0) {
            // Leeres Dokument – zeige Platzhalter
            const placeholder = svgWrapper.createDiv({ cls: 'ink-embed-placeholder' });
            placeholder.setText('✏ ' + this.file.basename);
            svgWrapper.addEventListener('click', () => this.activateEdit());
            return;
        }

        // Alle Blöcke sequenziell als SVGs rendern
        for (const block of this.blocks) {
            const blockSvg = this.buildBlockSVG(block);
            if (blockSvg) svgWrapper.appendChild(blockSvg);
        }

        svgWrapper.addEventListener('click', () => this.activateEdit());
    }

    private buildBlockSVG(block: Block): SVGSVGElement | null {
        if (!this.inkDoc) return null;
        const strokes = block.strokeIds
            .map(id => this.inkDoc!.strokes.find(s => s.id === id))
            .filter((s): s is Stroke => !!s);

        if (strokes.length === 0) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const stroke of strokes) {
            for (const p of stroke.points) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            }
        }

        const pad = 8;
        const vbX = minX - pad, vbY = minY - pad;
        const vbW = (maxX - minX) + pad * 2;
        const vbH = (maxY - minY) + pad * 2;

        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg') as SVGSVGElement;
        svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.width = '100%';
        svg.style.display = 'block';
        svg.style.height = `${Math.min(block.bbox.height, 400)}px`;

        // Hintergrund: CSS-Variable bei useColor=false (passt sich dem Obsidian-Theme an), sonst gespeicherte Block-Farbe
        const useColor = block.displaySettings?.useColor ?? false;
        const isDark = document.body.classList.contains('theme-dark');
        const themeBackground = getComputedStyle(document.body).getPropertyValue('--background-primary').trim()
            || (isDark ? '#1a1a1a' : '#ffffff');
        const bgColor = !useColor
            ? themeBackground
            : (block.displaySettings?.backgroundColor ?? '#ffffff');
        const bg = document.createElementNS(ns, 'rect');
        bg.setAttribute('x', String(vbX)); bg.setAttribute('y', String(vbY));
        bg.setAttribute('width', String(vbW)); bg.setAttribute('height', String(vbH));
        bg.setAttribute('fill', bgColor);
        svg.appendChild(bg);

        // Grid als SVG-Pattern einzeichnen
        const grid = block.displaySettings?.grid;
        if (grid?.enabled && grid.type !== 'none') {
            this.appendGridToSVG(svg, ns, vbX, vbY, vbW, vbH, grid, useColor);
        }

        // Drawing-Blöcke: gespeicherte Strichdicke, kein block-spezifischer Multiplikator.
        // Alle anderen Typen: typeMultiplier × widthMultiplier (+ bold-Semantic in appendSVGStroke).
        const isDrawing = block.type === 'drawing';
        const typeMultiplier = isDrawing ? 1.0 : this.getTypeWidthMultiplier(block.type);
        const widthMultiplier = isDrawing ? 1.0 : (block.displaySettings?.widthMultiplier ?? 1.0) * typeMultiplier;

        for (const stroke of strokes) {
            this.appendSVGStroke(svg, stroke, ns, widthMultiplier, useColor, isDrawing);
        }
        return svg;
    }

    private getTypeWidthMultiplier(type: BlockType): number {
        switch (type) {
            case 'heading1': return 2.5;
            case 'heading2': return 2.0;
            case 'heading3': return 1.75;
            case 'heading4': return 1.5;
            case 'heading5': return 1.25;
            case 'math': return 1.25;
            case 'quote': return 1.0;
            default: return 1.0;
        }
    }

    private appendGridToSVG(
        svg: SVGSVGElement, ns: string,
        x: number, y: number, w: number, h: number,
        grid: GridSettings, useColor: boolean
    ): void {
        // Grid-Farbe: gespeicherte Farbe wenn useColor==true, sonst Theme-Farbe
        const isDark = document.body.classList.contains('theme-dark');
        const gridColor = useColor
            ? grid.color
            : (isDark ? '#555555' : '#d0d0d0');

        const defs = document.createElementNS(ns, 'defs');
        const pid = `ink-grid-${Math.random().toString(36).slice(2)}`;
        const pat = document.createElementNS(ns, 'pattern');
        pat.setAttribute('id', pid);
        pat.setAttribute('patternUnits', 'userSpaceOnUse');
        pat.setAttribute('width', String(grid.size));
        pat.setAttribute('height', String(grid.size));

        if (grid.type === 'dots') {
            const dot = document.createElementNS(ns, 'circle');
            dot.setAttribute('cx', String(grid.size / 2));
            dot.setAttribute('cy', String(grid.size / 2));
            dot.setAttribute('r', '1');
            dot.setAttribute('fill', gridColor);
            dot.setAttribute('opacity', String(grid.opacity));
            pat.appendChild(dot);
        } else {
            // grid or lines
            const path = document.createElementNS(ns, 'path');
            const d = grid.type === 'grid'
                ? `M ${grid.size} 0 L 0 0 0 ${grid.size}`   // L-Form für grid
                : `M 0 ${grid.size} L ${grid.size} ${grid.size}`; // nur horizontal für lines
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', gridColor);
            path.setAttribute('stroke-width', '2');
            path.setAttribute('opacity', String(grid.opacity));
            pat.appendChild(path);
        }

        defs.appendChild(pat);
        svg.appendChild(defs);

        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', String(x)); rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(w)); rect.setAttribute('height', String(h));
        rect.setAttribute('fill', `url(#${pid})`);
        svg.appendChild(rect);
    }

    private appendSVGStroke(
        svg: SVGSVGElement, stroke: Stroke, ns: string,
        widthMultiplier = 1.0, useColor = true, isDrawing = false
    ): void {
        if (stroke.points.length < 2) return;
        const path = document.createElementNS(ns, 'path') as SVGPathElement;

        if (stroke.bezierCurves?.length) {
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

        const baseWidth = isDrawing ? stroke.style.width ?? 2 : 2;
        const isHighlight = stroke.style.semantic === 'highlight';
        const isBold = stroke.style.semantic === 'bold';
        const isItalic = stroke.style.semantic === 'italic';

        // bold: 1.5× zusätzlich zum block-spezifischen Multiplikator
        let semanticMul = isBold ? 1.5 : 1.0;
        semanticMul = isItalic ? 0.75 : semanticMul;

        const effectiveWidth = isHighlight
            ? baseWidth * 3
            : baseWidth * widthMultiplier * semanticMul;

        const isDark = document.body.classList.contains('theme-dark');
        const themeColor = getComputedStyle(document.body).getPropertyValue('--text-normal').trim()
            || (isDark ? '#ffffff' : '#000000');

        // CSS-Variablen auflösen (z.B. "var(--text-normal)")
        const resolveColor = (c: string): string => {
            if (!c) return themeColor;
            if (c.startsWith('var(')) {
                const varName = c.slice(4, -1).trim();
                return getComputedStyle(document.body).getPropertyValue(varName).trim() || themeColor;
            }
            return c;
        };

        const color = useColor
            ? resolveColor(stroke.style.color ?? '#000000')
            : themeColor;

        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', String(effectiveWidth));
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        if (isHighlight) {
            path.setAttribute('stroke-opacity', '0.35');
        } else if ((stroke.style.opacity ?? 1) < 1) {
            path.setAttribute('stroke-opacity', String(stroke.style.opacity));
        }
        svg.appendChild(path);
    }

    // ─── Edit-Modus aktivieren ─────────────────────────────────────────────────

    private async activateEdit(): Promise<void> {
        if (this.mode === 'edit') return;
        this.mode = 'edit';

        this.containerEl.empty();
        this.containerEl.addClass('ink-embed--edit');

        // Sicherstellen dass mindestens ein Block vorhanden ist
        if (this.blocks.length === 0) {
            this.addBlock('paragraph', false);
        }

        this.buildToolbar();
        this.buildBlocksContainer();

        // Klick außerhalb → speichern & zurück zur Vorschau
        const onOutsideClick = (e: MouseEvent) => {
            if (!this.containerEl.contains(e.target as Node)) {
                document.removeEventListener('mousedown', onOutsideClick, true);
                this.deactivateEdit();
            }
        };
        // Timeout damit der aktuelle Klick nicht sofort feuert
        setTimeout(() => {
            document.addEventListener('mousedown', onOutsideClick, true);
        }, 50);
    }

    private async deactivateEdit(): Promise<void> {
        if (this.mode !== 'edit') return;
        this.mode = 'preview';
        await this.saveDocument();
        this.renderPreview();
    }

    // ─── Toolbar ───────────────────────────────────────────────────────────────

    private buildToolbar(): void {
        this.toolbar = this.containerEl.createDiv({ cls: 'ink-embed-toolbar' });
        this.syncToolbarToBlock();
    }

    /**
     * Befüllt / aktualisiert alle Toolbar-Controls anhand des aktuell ausgewählten Blocks.
     * Wird beim ersten Aufbau und bei Blockwechsel aufgerufen.
     */
    private syncToolbarToBlock(): void {
        if (!this.toolbar) return;
        this.toolbar.empty();

        const block = this.blocks[this.currentBlockIndex];
        const ds = block?.displaySettings;

        // ── Stift / Radierer ──────────────────────────────────────────────────
        const penBtn = this.createToolBtn('✒', 'Stift', this.currentTool === 'pen', () => {
            this.currentTool = 'pen';
            this.updateToolActive(this.toolbar!, 'pen');
        });
        penBtn.dataset.tool = 'pen';

        const eraserBtn = this.createToolBtn('⌫', 'Radierer', this.currentTool === 'eraser', () => {
            this.currentTool = 'eraser';
            this.updateToolActive(this.toolbar!, 'eraser');
        });
        eraserBtn.dataset.tool = 'eraser';

        this.toolbar.appendChild(this.createSep());

        // ── Stiftfarbe ───────────────────────────────────────────────────────
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = this.currentPenStyle.color;
        colorInput.title = 'Stiftfarbe';
        colorInput.className = 'ink-embed-color';
        colorInput.addEventListener('input', () => {
            this.currentPenStyle = { ...this.currentPenStyle, color: colorInput.value };
        });
        this.toolbar.appendChild(colorInput);

        // ── Strichbreite ─────────────────────────────────────────────────────
        const widthInput = document.createElement('input');
        widthInput.type = 'range';
        widthInput.min = '1'; widthInput.max = '8'; widthInput.value = String(this.currentPenStyle.width);
        widthInput.title = 'Strichbreite';
        widthInput.className = 'ink-embed-width';
        widthInput.addEventListener('input', () => {
            this.currentPenStyle = { ...this.currentPenStyle, width: parseFloat(widthInput.value) };
        });
        this.toolbar.appendChild(widthInput);

        this.toolbar.appendChild(this.createSep());

        // ── Use Color Toggle ──────────────────────────────────────────────────
        const currentUseColor = ds?.useColor ?? true;
        const useColorBtn = this.createToolBtn('🎨', 'Farbe verwenden', currentUseColor, () => {
            const b = this.blocks[this.currentBlockIndex];
            if (!b) return;
            const settings = this.ensureDisplaySettings(b);
            settings.useColor = !settings.useColor;
            useColorBtn.classList.toggle('active', settings.useColor);
            // Hintergrundfarb-Picker nur aktiv wenn useColor=false
            bgColorInput.disabled = settings.useColor;
            this.redrawCurrentBlock();
        });
        useColorBtn.dataset.tool = 'useColor';

        // ── Hintergrundfarbe (pro Block) ──────────────────────────────────────
        const bgColorLabel = document.createElement('span');
        bgColorLabel.textContent = 'BG:';
        bgColorLabel.className = 'ink-embed-label';
        this.toolbar.appendChild(bgColorLabel);

        const bgColorInput = document.createElement('input');
        bgColorInput.type = 'color';
        bgColorInput.value = ds?.backgroundColor ?? '#ffffff';
        bgColorInput.title = 'Hintergrundfarbe (nur bei deaktiviertem Use Color)';
        bgColorInput.className = 'ink-embed-color';
        bgColorInput.disabled = currentUseColor; // gesperrt solange useColor aktiv
        bgColorInput.addEventListener('input', () => {
            const b = this.blocks[this.currentBlockIndex];
            if (!b) return;
            this.ensureDisplaySettings(b).backgroundColor = bgColorInput.value;
            this.redrawCurrentBlock();
        });
        this.toolbar.appendChild(bgColorInput);

        this.toolbar.appendChild(this.createSep());

        // ── Zoom / widthMultiplier ────────────────────────────────────────────
        const zoomLabel = document.createElement('span');
        zoomLabel.textContent = 'Zoom:';
        zoomLabel.className = 'ink-embed-label';
        this.toolbar.appendChild(zoomLabel);

        const zoomInput = document.createElement('input');
        zoomInput.type = 'range';
        zoomInput.min = '0.5'; zoomInput.max = '3'; zoomInput.step = '0.1';
        zoomInput.value = String(ds?.widthMultiplier ?? 1.0);
        zoomInput.title = 'Strichdicken-Zoom (nur bei Nicht-Drawing-Blöcken)';
        zoomInput.className = 'ink-embed-width';
        zoomInput.disabled = block?.type === 'drawing'; // Drawing nutzt gespeicherte Dicke
        zoomInput.addEventListener('input', () => {
            const b = this.blocks[this.currentBlockIndex];
            if (!b) return;
            this.ensureDisplaySettings(b).widthMultiplier = parseFloat(zoomInput.value);
            this.redrawCurrentBlock();
        });
        this.toolbar.appendChild(zoomInput);

        this.toolbar.appendChild(this.createSep());

        // ── Grid ──────────────────────────────────────────────────────────────
        const gridCheck = document.createElement('input');
        gridCheck.type = 'checkbox';
        gridCheck.checked = ds?.grid?.enabled ?? false;
        gridCheck.title = 'Grid';
        this.toolbar.appendChild(gridCheck);
        this.toolbar.createSpan({ cls: 'ink-embed-label', text: 'Grid' });

        const gridTypeSelect = document.createElement('select');
        gridTypeSelect.className = 'ink-embed-select';
        ['grid', 'lines', 'dots'].forEach(t => {
            const o = document.createElement('option');
            o.value = t; o.textContent = t;
            if ((ds?.grid?.type ?? 'grid') === t) o.selected = true;
            gridTypeSelect.appendChild(o);
        });
        this.toolbar.appendChild(gridTypeSelect);

        const updateGrid = () => {
            const b = this.blocks[this.currentBlockIndex];
            if (!b) return;
            const settings = this.ensureDisplaySettings(b);
            settings.grid.enabled = gridCheck.checked;
            settings.grid.type = gridTypeSelect.value as any;
            this.redrawCurrentBlock();
        };
        gridCheck.addEventListener('change', updateGrid);
        gridTypeSelect.addEventListener('change', updateGrid);

        this.toolbar.appendChild(this.createSep());

        // ── Block hinzufügen ──────────────────────────────────────────────────
        this.createToolBtn('＋ Block', 'Neuer Block', false, () => {
            this.addBlock('paragraph', true);
        });
    }

    // ─── Hilfsmethoden ────────────────────────────────────────────────────────

    private ensureDisplaySettings(block: Block): BlockDisplaySettings {
        if (!block.displaySettings) {
            block.displaySettings = {
                grid: { enabled: false, type: 'grid', size: 20, color: '#e0e0e0', opacity: 0.5 },
                useColor: true,
                widthMultiplier: 1.0,
                backgroundColor: '#ffffff',
            };
        }
        return block.displaySettings;
    }

    private redrawCurrentBlock(): void {
        const block = this.blocks[this.currentBlockIndex];
        if (!block || !this.blocksContainer) return;
        const blockEl = this.blocksContainer.querySelector<HTMLElement>(
            `.ink-embed-block[data-block-id="${block.id}"]`
        );
        const canvas = blockEl?.querySelector('canvas') as HTMLCanvasElement | null;
        if (canvas) this.drawBlockStrokes(canvas, block);
    }

    private createToolBtn(label: string, title: string, active: boolean, onClick: () => void): HTMLElement {
        const btn = this.toolbar!.createEl('button', { cls: 'ink-embed-tool-btn', text: label });
        btn.title = title;
        if (active) btn.addClass('active');
        btn.addEventListener('click', onClick);
        return btn;
    }

    private createSep(): HTMLElement {
        const sep = document.createElement('span');
        sep.className = 'ink-embed-sep';
        sep.textContent = '|';
        return sep;
    }

    private updateToolActive(toolbar: HTMLElement, tool: string): void {
        toolbar.querySelectorAll<HTMLElement>('[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    }

    // ─── Blöcke-Container ──────────────────────────────────────────────────────

    private buildBlocksContainer(): void {
        this.blocksContainer = this.containerEl.createDiv({ cls: 'ink-embed-blocks' });
        this.renderAllBlocks();
    }

    private renderAllBlocks(): void {
        if (!this.blocksContainer) return;
        this.blocksContainer.empty();
        this.blocks.forEach((block, index) => {
            this.renderBlock(block, index);
        });
    }

    private renderBlock(block: Block, index: number): void {
        if (!this.blocksContainer || !this.inkDoc) return;

        const isSelected = index === this.currentBlockIndex;

        const blockEl = this.blocksContainer.createDiv({ cls: 'ink-embed-block' });
        blockEl.dataset.blockId = block.id;
        if (isSelected) blockEl.addClass('selected');

        const canvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        const w = block.bbox.width;
        const h = block.bbox.height;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = '100%';       // Breite immer 100% des Containers
        canvas.style.height = `${h}px`;    // Höhe explizit, wächst nach unten
        canvas.style.display = 'block';
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'crosshair';

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.scale(dpr, dpr);
            ctx.imageSmoothingEnabled = true;
        }

        blockEl.appendChild(canvas);

        // Vorhandene Strokes zeichnen
        this.drawBlockStrokes(canvas, block);

        // Events einrichten
        this.setupCanvasEvents(canvas, index, block);

        // Block auswählen beim Klick
        blockEl.addEventListener('mousedown', () => {
            if (this.currentBlockIndex !== index) {
                this.currentBlockIndex = index;
                this.highlightSelectedBlock();
                // Toolbar-Controls auf den neuen Block synchronisieren
                this.syncToolbarToBlock();
            }
        });
    }

    private highlightSelectedBlock(): void {
        if (!this.blocksContainer) return;
        this.blocksContainer.querySelectorAll<HTMLElement>('.ink-embed-block').forEach((el, i) => {
            el.classList.toggle('selected', i === this.currentBlockIndex);
        });
    }

    // ─── Canvas-Events ─────────────────────────────────────────────────────────

    private setupCanvasEvents(canvas: HTMLCanvasElement, blockIndex: number, block: Block): void {
        let isDown = false;
        let lastPoint: Point | null = null;
        let currentStroke: Point[] = [];

        const getPoint = (e: PointerEvent): Point => {
            const rect = canvas.getBoundingClientRect();
            const scaleX = block.bbox.width / rect.width;
            const scaleY = block.bbox.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY,
                t: Date.now(),
                pressure: e.pressure || 0.5
            };
        };

        canvas.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            canvas.setPointerCapture(e.pointerId);
            isDown = true;
            const pt = getPoint(e);
            currentStroke = [pt];
            lastPoint = pt;

            if (this.currentTool === 'eraser') {
                this.eraseAt(block, pt);
                this.drawBlockStrokes(canvas, block);
            }
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!isDown) return;
            const pt = getPoint(e);
            currentStroke.push(pt);

            if (this.currentTool === 'pen' && lastPoint) {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    const dpr = window.devicePixelRatio || 1;
                    ctx.save();
                    ctx.scale(dpr, dpr);
                    ctx.beginPath();
                    ctx.moveTo(lastPoint.x, lastPoint.y);
                    ctx.lineTo(pt.x, pt.y);
                    ctx.strokeStyle = this.currentPenStyle.color;
                    ctx.lineWidth = this.currentPenStyle.width;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.stroke();
                    ctx.restore();
                }
            } else if (this.currentTool === 'eraser') {
                this.eraseAt(block, pt);
                this.drawBlockStrokes(canvas, block);
            }

            // Nur nach unten erweitern
            if (pt.y > block.bbox.height - 30) {
                this.expandBlockHeight(canvas, block, 80);
            }

            lastPoint = pt;
        });

        canvas.addEventListener('pointerup', (e) => {
            if (!isDown || !this.inkDoc) return;
            isDown = false;
            canvas.releasePointerCapture(e.pointerId);

            if (this.currentTool === 'pen' && currentStroke.length >= 2) {
                // Bezier-Fitting
                const fitter = new BezierCurveFitter({ epsilon: 1.5 });
                const curves = fitter.fitCurve(currentStroke);

                const stroke: Stroke = {
                    id: crypto.randomUUID(),
                    points: currentStroke,
                    bezierCurves: curves,
                    style: { ...this.currentPenStyle },
                    createdAt: new Date().toISOString()
                };

                this.inkDoc.addStroke(stroke);
                block.strokeIds.push(stroke.id);
            }

            currentStroke = [];
            lastPoint = null;
        });
    }

    // ─── Block-Hilfsfunktionen ─────────────────────────────────────────────────

    private drawBlockStrokes(canvas: HTMLCanvasElement, block: Block): void {
        if (!this.inkDoc) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(dpr, dpr);

        // Hintergrundfarbe: CSS-Variable bei useColor=true, sonst gespeicherte Block-Farbe
        const useColor = block.displaySettings?.useColor ?? true;
        const isDark = document.body.classList.contains('theme-dark');
        const themeBackground = getComputedStyle(document.body).getPropertyValue('--background-primary').trim()
            || (isDark ? '#1a1a1a' : '#ffffff');
        const bgColor = useColor
            ? themeBackground
            : (block.displaySettings?.backgroundColor ?? '#ffffff');
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, block.bbox.width, block.bbox.height);

        // Drawing-Blöcke: gespeicherte Strichdicke, kein Multiplikator.
        // Alle anderen Typen: typeMultiplier × widthMultiplier.
        const isDrawing = block.type === 'drawing';
        const typeMultiplier = isDrawing ? 1.0 : this.getTypeWidthMultiplier(block.type);
        const widthMultiplier = isDrawing ? 1.0 : (block.displaySettings?.widthMultiplier ?? 1.0) * typeMultiplier;

        for (const strokeId of block.strokeIds) {
            const stroke = this.inkDoc.strokes.find(s => s.id === strokeId);
            if (!stroke || stroke.points.length < 2) continue;

            const color = useColor
                ? (stroke.style.color ?? '#000000')
                : (isDark ? '#ffffff' : '#000000');
            const isHighlight = stroke.style.semantic === 'highlight';
            const isBold = stroke.style.semantic === 'bold';
            // bold: 1.5× zusätzlich zum block-spezifischen Multiplikator
            let semanticMul = isBold ? 1.5 : 1.0;
            semanticMul = stroke.style.semantic === 'italic' ? 0.75 : semanticMul;
            const width = isHighlight
                ? (stroke.style.width ?? 2) * 3
                : (stroke.style.width ?? 2) * widthMultiplier * semanticMul;

            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.globalAlpha = isHighlight ? 0.35 : (stroke.style.opacity ?? 1);

            if (stroke.bezierCurves?.length) {
                ctx.moveTo(stroke.bezierCurves[0]!.p0.x, stroke.bezierCurves[0]!.p0.y);
                for (const c of stroke.bezierCurves)
                    ctx.bezierCurveTo(c.p1.x, c.p1.y, c.p2.x, c.p2.y, c.p3.x, c.p3.y);
            } else {
                ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
                for (let i = 1; i < stroke.points.length; i++)
                    ctx.lineTo(stroke.points[i]!.x, stroke.points[i]!.y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    }

    private expandBlockHeight(canvas: HTMLCanvasElement, block: Block, amount: number): void {
        const dpr = window.devicePixelRatio || 1;
        const oldH = block.bbox.height;
        block.bbox.height += amount;

        // Alten Inhalt sichern
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        tempCanvas.getContext('2d')?.drawImage(canvas, 0, 0);

        // Canvas vergrößern
        canvas.height = block.bbox.height * dpr;
        canvas.style.height = `${block.bbox.height}px`;

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.scale(dpr, dpr);
            ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height,
                0, 0, block.bbox.width, oldH);
        }
    }

    private eraseAt(block: Block, point: Point): void {
        if (!this.inkDoc) return;
        const RADIUS = 15;
        block.strokeIds = block.strokeIds.filter(id => {
            const stroke = this.inkDoc!.strokes.find(s => s.id === id);
            if (!stroke) return false;
            const hit = stroke.points.some(p =>
                Math.hypot(p.x - point.x, p.y - point.y) < RADIUS
            );
            if (hit) this.inkDoc!.removeStroke(id);
            return !hit;
        });
    }

    private addBlock(type: BlockType, rerender: boolean): void {
        const newBlock: Block = {
            id: crypto.randomUUID(),
            type,
            strokeIds: [],
            bbox: { x: 0, y: 0, width: 760, height: 200 },
            order: this.blocks.length
        };
        this.blocks.push(newBlock);
        this.currentBlockIndex = this.blocks.length - 1;
        if (rerender && this.blocksContainer) {
            this.renderBlock(newBlock, this.blocks.length - 1);
            this.highlightSelectedBlock();
        }
    }
}