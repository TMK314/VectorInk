import { Block, BlockDisplaySettings, StrokeStyle } from '../types';
import { InkView } from './InkView';

/**
 * Toolbar-Reihenfolge:
 *   1. Speichern · Undo · Redo
 *   2. Werkzeuge (Stift · Radierer · Auswahl)
 *   3a. Stift-Eigenschaften  (nur wenn Stift aktiv)
 *   3b. Auswahl-Aktionen     (nur wenn Auswahl aktiv)
 *   4. Block-Einstellungen   (UseColor · HG-Farbe · Grid · Dekorationen)
 *   5. Zoom (Strichstärken-Multiplikator)
 *   6. Glättung (Epsilon)
 *   7. Neuer Block
 */
export class ToolbarManager {
    private context: InkView;
    public  toolbar: HTMLElement | null = null;

    // ── Werkzeug-Buttons ────────────────────────────────────────────────────
    private penBtn:    HTMLElement | null = null;
    private eraserBtn: HTMLElement | null = null;
    private selectBtn: HTMLElement | null = null;

    // ── Kontextuelle Abschnitte ─────────────────────────────────────────────
    private penPropsSection:       HTMLElement | null = null;
    private selectionPropsSection: HTMLElement | null = null;

    // ── Stift-Controls ──────────────────────────────────────────────────────
    private strokeColorInput:   HTMLInputElement | null = null;
    private strokeOpacityInput: HTMLInputElement | null = null;
    private strokeWidthInput:   HTMLInputElement | null = null;
    private formatBtns: Map<string, HTMLElement> = new Map();

    // ── Block-Einstellungen ─────────────────────────────────────────────────
    public  useColorForStyling   = true;
    private colorToggle:          HTMLInputElement | null = null;
    private bgColorInput:         HTMLInputElement | null = null;
    private decorationSection:    HTMLElement | null = null;
    private showSeparatorCheck:   HTMLInputElement | null = null;
    private showQuoteBarCheck:    HTMLInputElement | null = null;

    // ── Grid ────────────────────────────────────────────────────────────────
    private gridContainer:       HTMLElement | null = null;
    private gridEnabledCheckbox: HTMLInputElement | null = null;
    private gridTypeSelect:      HTMLSelectElement | null = null;
    private gridSizeInput:       HTMLInputElement | null = null;
    private gridOpacityInput:    HTMLInputElement | null = null;
    private gridColorInput:      HTMLInputElement | null = null;
    private gridLineWidthInput:  HTMLInputElement | null = null;

    // ── Zoom / Epsilon ──────────────────────────────────────────────────────
    private widthMultiplierInput: HTMLInputElement | null = null;
    private multiplierValue:      HTMLSpanElement  | null = null;
    public  epsilonInput:          HTMLInputElement | null = null;

    // ── Undo / Redo ─────────────────────────────────────────────────────────
    private undoBtn: HTMLButtonElement | null = null;
    private redoBtn: HTMLButtonElement | null = null;

    // Legacy – werden ggf. von anderen Managern referenziert
    public marginTopInput:    HTMLInputElement | null = null;
    public marginBottomInput: HTMLInputElement | null = null;

    constructor(context: InkView) {
        this.context = context;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Toolbar aufbauen
    // ════════════════════════════════════════════════════════════════════════

    public createToolbar(container: HTMLElement): void {
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'ink-toolbar';

        const block      = this.getCurrentBlock();
        const activeTool = this.context.drawingManager.currentTool;

        // 1 ── Speichern · Undo · Redo ───────────────────────────────────────
        this.toolbar.appendChild(this.btn('💾', 'Speichern (Ctrl+S)',
            () => this.context.saveDocument()));

        this.undoBtn = this.btn('↩', 'Rückgängig (Ctrl+Z)',
            () => this.context.historyManager?.undo()) as HTMLButtonElement;
        this.undoBtn.disabled = true;
        this.toolbar.appendChild(this.undoBtn);

        this.redoBtn = this.btn('↪', 'Wiederholen (Ctrl+Y)',
            () => this.context.historyManager?.redo()) as HTMLButtonElement;
        this.redoBtn.disabled = true;
        this.toolbar.appendChild(this.redoBtn);

        // 2 ── Werkzeuge ──────────────────────────────────────────────────────
        this.toolbar.appendChild(this.sep());

        this.penBtn = this.btn('✏️', 'Stift (Ctrl+P)',
            () => this.context.drawingManager.setTool('pen'));
        this.toolbar.appendChild(this.penBtn);

        this.eraserBtn = this.btn('🧽', 'Radierer (Ctrl+E)',
            () => this.context.drawingManager.setTool('eraser'));
        this.toolbar.appendChild(this.eraserBtn);

        this.selectBtn = this.btn('↖️', 'Auswahl',
            () => this.context.drawingManager.setTool('selection'));
        this.toolbar.appendChild(this.selectBtn);

        // Initiale Hervorhebung
        this.highlightToolBtn(activeTool);

        // 3a ── Stift-Eigenschaften ────────────────────────────────────────────
        this.toolbar.appendChild(this.sep());
        this.penPropsSection = this.buildPenProps(block);
        this.penPropsSection.style.display = (activeTool === 'pen' || activeTool === 'selection') ? 'flex' : 'none';
        this.toolbar.appendChild(this.penPropsSection);

        // 3b ── Auswahl-Aktionen ──────────────────────────────────────────────
        this.selectionPropsSection = this.buildSelectionProps();
        this.selectionPropsSection.style.display = activeTool === 'selection' ? 'flex' : 'none';
        this.toolbar.appendChild(this.selectionPropsSection);

        // 4 ── Block-Einstellungen ─────────────────────────────────────────────
        this.toolbar.appendChild(this.sep());
        this.buildBlockSettings(block);

        // 5 ── Zoom ───────────────────────────────────────────────────────────
        this.toolbar.appendChild(this.sep());
        this.buildZoom(block);

        // 6 ── Glättung ───────────────────────────────────────────────────────
        this.toolbar.appendChild(this.sep());
        this.buildEpsilon();

        // 7 ── Neuer Block ─────────────────────────────────────────────────────
        this.toolbar.appendChild(this.sep());
        this.toolbar.appendChild(this.btn('＋ Block', 'Neuen Block hinzufügen',
            () => this.context.blockManager.addNewBlock('paragraph', this.context.blocks.length)));

        container.appendChild(this.toolbar);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Abschnitt 3a: Stift-Eigenschaften
    // ════════════════════════════════════════════════════════════════════════

    private buildPenProps(block: Block | undefined): HTMLElement {
        const pen     = this.context.drawingManager.currentPenStyle;
        const section = this.row();

        // Farbe
        section.appendChild(this.lbl('Farbe'));
        this.strokeColorInput = document.createElement('input');
        this.strokeColorInput.type      = 'color';
        this.strokeColorInput.value     = pen.color;
        this.strokeColorInput.className = 'ink-tb-color';
        this.strokeColorInput.title     = 'Stiftfarbe';
        this.strokeColorInput.onchange  = (e) => {
            const color = (e.target as HTMLInputElement).value;
            if (this.context.strokeSelectionManager.selectedStrokes.size > 0)
                this.context.strokeSelectionManager.applyStyleToSelectedStrokes({ color });
            else {
                this.context.drawingManager.currentPenStyle.color = color;
                this.context.styleManager.updateThemeColors();
            }
        };
        section.appendChild(this.strokeColorInput);

        // Deckkraft
        section.appendChild(this.lbl('Opacity'));
        this.strokeOpacityInput = this.rangeInput(0, 100, 1,
            Math.round((pen.opacity ?? 1) * 100), '60px', 'Deckkraft');
        this.strokeOpacityInput.oninput = (e) => {
            const opacity = parseInt((e.target as HTMLInputElement).value) / 100;
            if (this.context.strokeSelectionManager.selectedStrokes.size > 0)
                this.context.strokeSelectionManager.applyStyleToSelectedStrokes({ opacity });
            else this.context.drawingManager.currentPenStyle.opacity = opacity;
        };
        section.appendChild(this.strokeOpacityInput);

        // Breite
        section.appendChild(this.lbl('Breite'));
        this.strokeWidthInput = this.rangeInput(1, 20, 1, pen.width, '60px', 'Strichbreite');
        this.strokeWidthInput.oninput = (e) => {
            const width = parseInt((e.target as HTMLInputElement).value);
            if (this.context.strokeSelectionManager.selectedStrokes.size > 0)
                this.context.strokeSelectionManager.applyStyleToSelectedStrokes({ width });
            else this.context.drawingManager.currentPenStyle.width = width;
        };
        section.appendChild(this.strokeWidthInput);

        // Format-Buttons
        section.appendChild(this.lbl('Format'));
        const curSemantic = pen.semantic ?? 'normal';
        this.formatBtns.clear();
        for (const [key, text, title, fw, fi] of [
            ['normal',    'N',  'Normal',      'normal', 'normal'],
            ['bold',      'B',  'Fett',        'bold',   'normal'],
            ['italic',    'I',  'Kursiv',      'normal', 'italic'],
            ['highlight', '✦', 'Markierung',  'normal', 'normal'],
        ] as const) {
            const fbtn = this.formatBtn(text, key, title, fw, fi, curSemantic === key);
            fbtn.onclick = () => {
                this.setActiveSemantic(key);
                if (this.context.strokeSelectionManager.selectedStrokes.size > 0)
                    this.context.strokeSelectionManager.applyStyleToSelectedStrokes({ semantic: key as any });
                else this.context.drawingManager.currentPenStyle.semantic = key as any;
            };
            this.formatBtns.set(key, fbtn);
            section.appendChild(fbtn);
        }

        return section;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Abschnitt 3b: Auswahl-Aktionen
    // ════════════════════════════════════════════════════════════════════════

    private buildSelectionProps(): HTMLElement {
        const section = this.row();
        section.appendChild(this.btn('⎘ Kopieren', 'Strokes kopieren (Ctrl+C)',
            () => this.context.strokeSelectionManager.copySelectedStrokes()));
        section.appendChild(this.btn('⎙ Einfügen', 'Strokes einfügen (Ctrl+V)',
            () => this.context.strokeSelectionManager.pasteStrokes(this.context.currentBlockIndex)));
        section.appendChild(this.btn('🗑 Löschen', 'Strokes löschen (Entf)',
            () => this.context.strokeSelectionManager.deleteSelectedStrokes()));
        return section;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Abschnitt 4: Block-Einstellungen
    // ════════════════════════════════════════════════════════════════════════

    private buildBlockSettings(block: Block | undefined): void {
        const ds = block?.displaySettings;

        // ── UseColor + Hintergrundfarbe ──────────────────────────────────────
        const colorRow = this.row();

        colorRow.appendChild(this.lbl('Farben'));
        this.colorToggle            = document.createElement('input');
        this.colorToggle.type       = 'checkbox';
        this.useColorForStyling     = ds?.useColor ?? true;
        this.colorToggle.checked    = this.useColorForStyling;
        this.colorToggle.title      = 'Strichfarben verwenden';
        this.colorToggle.style.transform = 'scale(0.9)';
        this.colorToggle.onchange   = () => {
            this.useColorForStyling = this.colorToggle!.checked;
            const val = this.useColorForStyling;
            this.pushBlockRestyleHistory(b => {
                this.ensureBlockDS(b).useColor = val; return { useColor: val };
            });
            if (this.bgColorInput) this.bgColorInput.disabled = !val;
            this.context.drawingManager.redrawAllBlocks();
        };
        colorRow.appendChild(this.colorToggle);

        colorRow.appendChild(this.lbl('HG'));
        this.bgColorInput           = document.createElement('input');
        this.bgColorInput.type      = 'color';
        this.bgColorInput.value     = ds?.backgroundColor ?? '#ffffff';
        this.bgColorInput.title     = 'Hintergrundfarbe des Blocks (nur bei Farben = aus)';
        this.bgColorInput.className = 'ink-tb-color';
        this.bgColorInput.disabled  = this.useColorForStyling;
        this.bgColorInput.oninput   = () => {
            const c = this.bgColorInput!.value;
            this.pushBlockRestyleHistory(b => {
                this.ensureBlockDS(b).backgroundColor = c; return { backgroundColor: c };
            });
            this.context.drawingManager.redrawAllBlocks();
        };
        colorRow.appendChild(this.bgColorInput);
        this.toolbar!.appendChild(colorRow);

        // ── Grid ─────────────────────────────────────────────────────────────
        this.toolbar!.appendChild(this.sep());
        this.buildGrid(block);

        // ── Vorschau-Dekorationen ─────────────────────────────────────────────
        this.toolbar!.appendChild(this.sep());
        this.buildDecorations(block);
    }

    // ── Grid ────────────────────────────────────────────────────────────────

    private buildGrid(block: Block | undefined): void {
        this.gridContainer = this.row();
        this.gridContainer.style.flexWrap = 'wrap';

        const gs = block?.displaySettings?.grid
            ?? this.context.document?.gridSettings
            ?? { enabled: false, type: 'grid' as const, size: 20,
                 color: '#e0e0e0', opacity: 0.5, lineWidth: 0.5 };

        // Toggle
        this.gridEnabledCheckbox         = document.createElement('input');
        this.gridEnabledCheckbox.type    = 'checkbox';
        this.gridEnabledCheckbox.checked = gs.enabled;
        this.gridEnabledCheckbox.title   = 'Grid aktivieren';
        const glbl = document.createElement('span');
        glbl.textContent = 'Grid'; glbl.style.cssText = 'font-size:12px;cursor:pointer;';
        glbl.onclick = () => {
            this.gridEnabledCheckbox!.checked = !this.gridEnabledCheckbox!.checked;
            this.gridEnabledCheckbox!.dispatchEvent(new Event('change'));
        };
        const toggleRow = this.row(); toggleRow.appendChild(this.gridEnabledCheckbox); toggleRow.appendChild(glbl);
        this.gridContainer.appendChild(toggleRow);

        // Sub-Controls
        const subs: HTMLElement[] = [];

        // Typ
        const tRow = this.gridSubRow('Typ:');
        this.gridTypeSelect = document.createElement('select');
        this.gridTypeSelect.style.cssText = 'font-size:11px;padding:2px;background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:3px;';
        for (const t of ['grid', 'lines', 'dots']) {
            const o = document.createElement('option');
            o.value = t; o.textContent = t.charAt(0).toUpperCase() + t.slice(1);
            if (gs.type === t) o.selected = true;
            this.gridTypeSelect.appendChild(o);
        }
        this.gridTypeSelect.onchange = (e) => {
            const type = (e.target as HTMLSelectElement).value as 'grid' | 'lines' | 'dots';
            this.applyToSelected(b => { this.ensureBlockDS(b).grid.type = type; });
            this.context.document?.setGridSettings({ type });
            this.context.drawingManager.redrawAllBlocks();
        };
        tRow.appendChild(this.gridTypeSelect); subs.push(tRow);

        // Größe
        const szRow = this.gridSubRow('Größe:');
        this.gridSizeInput = document.createElement('input');
        this.gridSizeInput.type = 'number'; this.gridSizeInput.min = '5'; this.gridSizeInput.max = '100'; this.gridSizeInput.step = '5';
        this.gridSizeInput.value = String(gs.size);
        this.gridSizeInput.style.cssText = 'width:45px;font-size:11px;padding:2px;border:1px solid var(--background-modifier-border);border-radius:3px;';
        this.gridSizeInput.onchange = (e) => {
            const size = parseInt((e.target as HTMLInputElement).value);
            this.applyToSelected(b => { this.ensureBlockDS(b).grid.size = size; });
            this.context.document?.setGridSettings({ size });
            this.context.drawingManager.redrawAllBlocks();
        };
        szRow.appendChild(this.gridSizeInput); subs.push(szRow);

        // Deckkraft
        const opRow = this.gridSubRow('Deckkraft:');
        this.gridOpacityInput = this.rangeInput(0, 100, 1,
            Math.round((gs.opacity ?? 0.5) * 100), '50px', 'Grid-Deckkraft');
        this.gridOpacityInput.onchange = (e) => {
            const opacity = parseInt((e.target as HTMLInputElement).value) / 100;
            this.applyToSelected(b => { this.ensureBlockDS(b).grid.opacity = opacity; });
            this.context.document?.setGridSettings({ opacity });
            this.context.drawingManager.redrawAllBlocks();
        };
        opRow.appendChild(this.gridOpacityInput); subs.push(opRow);

        // Farbe
        const cRow = this.gridSubRow('Farbe:');
        this.gridColorInput = document.createElement('input');
        this.gridColorInput.type = 'color'; this.gridColorInput.value = gs.color;
        this.gridColorInput.className = 'ink-tb-color';
        this.gridColorInput.onchange = (e) => {
            const color = (e.target as HTMLInputElement).value;
            this.applyToSelected(b => { this.ensureBlockDS(b).grid.color = color; });
            this.context.document?.setGridSettings({ color });
            this.context.drawingManager.redrawAllBlocks();
        };
        cRow.appendChild(this.gridColorInput); subs.push(cRow);

        // Linienbreite
        const lwRow = this.gridSubRow('Breite:');
        this.gridLineWidthInput = this.rangeInput(0.1, 5, 0.1,
            gs.lineWidth ?? 0.5, '50px', 'Grid-Linienbreite');
        this.gridLineWidthInput.onchange = (e) => {
            const lineWidth = parseFloat((e.target as HTMLInputElement).value);
            this.applyToSelected(b => { this.ensureBlockDS(b).grid.lineWidth = lineWidth; });
            this.context.document?.setGridSettings({ lineWidth });
            this.context.drawingManager.redrawAllBlocks();
        };
        lwRow.appendChild(this.gridLineWidthInput); subs.push(lwRow);

        const setSubVis = (v: boolean) => subs.forEach(el => { el.style.display = v ? 'flex' : 'none'; });
        setSubVis(gs.enabled);
        subs.forEach(el => this.gridContainer!.appendChild(el));

        this.gridEnabledCheckbox.onchange = (e) => {
            const enabled = (e.target as HTMLInputElement).checked;
            setSubVis(enabled);
            this.applyToSelected(b => { this.ensureBlockDS(b).grid.enabled = enabled; });
            this.context.document?.setGridSettings({ enabled });
            this.context.drawingManager.redrawAllBlocks();
        };

        this.toolbar!.appendChild(this.gridContainer);
    }

    private gridSubRow(label: string): HTMLElement {
        const r = this.row();
        const l = document.createElement('span');
        l.textContent = label; l.style.cssText = 'font-size:11px;opacity:0.8;';
        r.appendChild(l); return r;
    }

    // ── Vorschau-Dekorationen ────────────────────────────────────────────────

    private buildDecorations(block: Block | undefined): void {
        this.decorationSection = this.row();
        const isH = block?.type?.startsWith('heading') ?? false;
        const isQ = block?.type === 'quote';
        this.decorationSection.style.display = (isH || isQ) ? 'flex' : 'none';

        // Trennlinie (Heading)
        const sepWrap = document.createElement('label');
        sepWrap.dataset.decoration = 'separator';
        sepWrap.style.cssText = `display:${isH ? 'flex' : 'none'};align-items:center;gap:3px;font-size:12px;cursor:pointer;`;
        sepWrap.title = 'Horizontale Trennlinie unterhalb der Überschrift (Vorschau)';
        this.showSeparatorCheck         = document.createElement('input');
        this.showSeparatorCheck.type    = 'checkbox';
        this.showSeparatorCheck.checked = block?.displaySettings?.showSeparator ?? isH;
        this.showSeparatorCheck.onchange = () => {
            const b = this.getCurrentBlock(); if (!b) return;
            this.ensureBlockDS(b).showSeparator = this.showSeparatorCheck!.checked;
        };
        sepWrap.appendChild(this.showSeparatorCheck);
        sepWrap.appendChild(document.createTextNode('─ Trennlinie'));
        this.decorationSection.appendChild(sepWrap);

        // Zitatstrich (Quote)
        const barWrap = document.createElement('label');
        barWrap.dataset.decoration = 'quotebar';
        barWrap.style.cssText = `display:${isQ ? 'flex' : 'none'};align-items:center;gap:3px;font-size:12px;cursor:pointer;`;
        barWrap.title = 'Linker vertikaler Strich + Einrückung für Zitat-Blöcke (Vorschau)';
        this.showQuoteBarCheck         = document.createElement('input');
        this.showQuoteBarCheck.type    = 'checkbox';
        this.showQuoteBarCheck.checked = block?.displaySettings?.showQuoteBar ?? isQ;
        this.showQuoteBarCheck.onchange = () => {
            const b = this.getCurrentBlock(); if (!b) return;
            this.ensureBlockDS(b).showQuoteBar = this.showQuoteBarCheck!.checked;
        };
        barWrap.appendChild(this.showQuoteBarCheck);
        barWrap.appendChild(document.createTextNode('❝ Zitatstrich'));
        this.decorationSection.appendChild(barWrap);

        this.toolbar!.appendChild(this.decorationSection);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Abschnitt 5: Zoom
    // ════════════════════════════════════════════════════════════════════════

    private buildZoom(block: Block | undefined): void {
        const section  = this.row();
        section.appendChild(this.lbl('Zoom'));

        const initMult = block?.displaySettings?.widthMultiplier
            ?? this.context.drawingManager?.widthMultiplier ?? 1.0;

        this.widthMultiplierInput = this.rangeInput(0.5, 4.0, 0.1, initMult, '60px',
            'Strichstärken-Multiplikator');
        this.multiplierValue = document.createElement('span');
        this.multiplierValue.textContent = `${initMult.toFixed(1)}×`;
        this.multiplierValue.style.cssText = 'font-size:11px;min-width:28px;';

        this.widthMultiplierInput.oninput = () => {
            const value = parseFloat(this.widthMultiplierInput!.value);
            this.context.drawingManager.widthMultiplier = value;
            const b = this.getCurrentBlock();
            if (b) this.ensureBlockDS(b).widthMultiplier = value;
            this.multiplierValue!.textContent = `${value.toFixed(1)}×`;
            this.context.drawingManager.redrawAllBlocks();
        };

        section.appendChild(this.widthMultiplierInput);
        section.appendChild(this.multiplierValue);
        this.toolbar!.appendChild(section);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Abschnitt 6: Glättung (Epsilon)
    // ════════════════════════════════════════════════════════════════════════

    private buildEpsilon(): void {
        const section  = this.row();
        section.appendChild(this.lbl('Glättung'));

        const initEps = this.context.drawingManager.epsilon;
        this.epsilonInput = this.rangeInput(0.0, 5.0, 0.1, initEps, '60px',
            `Bezier-Epsilon: ${initEps.toFixed(1)} (niedriger = genauer)`);

        const epsVal = document.createElement('span');
        epsVal.textContent = initEps.toFixed(1);
        epsVal.style.cssText = 'font-size:11px;min-width:22px;';

        this.epsilonInput.oninput = (e) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            this.context.drawingManager.epsilon = v;
            epsVal.textContent = v.toFixed(1);
            this.epsilonInput!.title = `Bezier-Epsilon: ${v.toFixed(1)}`;
        };

        section.appendChild(this.epsilonInput);
        section.appendChild(epsVal);
        this.toolbar!.appendChild(section);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Sync-Methoden (public, von DrawingManager / BlockManager aufgerufen)
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Werkzeug-Buttons hervorheben und kontextuelle Abschnitte ein-/ausblenden.
     * Wird von DrawingManager.setTool() aufgerufen.
     */
    public syncToolbarToTool(tool: 'pen' | 'eraser' | 'selection'): void {
        this.highlightToolBtn(tool);
        if (this.penPropsSection)
            this.penPropsSection.style.display       = tool === 'pen' || tool === 'selection'       ? 'flex' : 'none';
        if (this.selectionPropsSection)
            this.selectionPropsSection.style.display  = tool === 'selection' ? 'flex' : 'none';
    }

    /**
     * Alle block-abhängigen Controls mit dem aktuellen Block synchronisieren.
     * Wird bei Blockwechsel und nach Undo/Redo aufgerufen.
     */
    public syncToolbarToCurrentBlock(): void {
        const block = this.getCurrentBlock();
        const ds    = block?.displaySettings;

        // UseColor + HG-Farbe
        const useColor = ds?.useColor ?? this.useColorForStyling;
        this.useColorForStyling = useColor;
        if (this.colorToggle)  this.colorToggle.checked  = useColor;
        if (this.bgColorInput) {
            this.bgColorInput.disabled = useColor;
            this.bgColorInput.value    = ds?.backgroundColor ?? '#ffffff';
        }

        // Zoom
        const mult = ds?.widthMultiplier ?? this.context.drawingManager?.widthMultiplier ?? 1.0;
        if (this.widthMultiplierInput) this.widthMultiplierInput.value = String(mult);
        if (this.multiplierValue)      this.multiplierValue.textContent = `${mult.toFixed(1)}×`;

        // Grid
        this.updateGridControls();

        // Dekorationen
        const isH = block?.type?.startsWith('heading') ?? false;
        const isQ = block?.type === 'quote';
        if (this.decorationSection) {
            this.decorationSection.style.display = (isH || isQ) ? 'flex' : 'none';
            const sw = this.decorationSection.querySelector<HTMLElement>('[data-decoration="separator"]');
            const bw = this.decorationSection.querySelector<HTMLElement>('[data-decoration="quotebar"]');
            if (sw) sw.style.display = isH ? 'flex' : 'none';
            if (bw) bw.style.display = isQ ? 'flex' : 'none';
        }
        if (this.showSeparatorCheck) this.showSeparatorCheck.checked = ds?.showSeparator ?? isH;
        if (this.showQuoteBarCheck)  this.showQuoteBarCheck.checked  = ds?.showQuoteBar  ?? isQ;

        // Stift-Stil
        const pen = this.context.drawingManager.currentPenStyle;
        if (this.strokeColorInput)   this.strokeColorInput.value   = pen.color;
        if (this.strokeOpacityInput) this.strokeOpacityInput.value = String(Math.round((pen.opacity ?? 1) * 100));
        if (this.strokeWidthInput)   this.strokeWidthInput.value   = String(pen.width);
        this.setActiveSemantic(pen.semantic ?? 'normal');
    }

    public updateGridControls(): void {
        const block = this.getCurrentBlock();
        const grid  = block?.displaySettings?.grid ?? this.context.document?.gridSettings;
        if (!grid) return;

        if (this.gridEnabledCheckbox) this.gridEnabledCheckbox.checked = grid.enabled;
        if (this.gridTypeSelect)      this.gridTypeSelect.value         = grid.type;
        if (this.gridSizeInput)       this.gridSizeInput.value          = String(grid.size);
        if (this.gridOpacityInput)    this.gridOpacityInput.value       = String(Math.round((grid.opacity ?? 0.5) * 100));
        if (this.gridColorInput)      this.gridColorInput.value         = grid.color;
        if (this.gridLineWidthInput)  this.gridLineWidthInput.value     = String(grid.lineWidth ?? 0.5);
        // Sub-Rows sichtbar?
        if (this.gridContainer) {
            this.gridContainer.querySelectorAll<HTMLElement>('div:not(:first-child)')
                .forEach(r => { r.style.display = grid.enabled ? 'flex' : 'none'; });
        }
    }

    public updateUndoRedoButtons(canUndo: boolean, canRedo: boolean): void {
        if (this.undoBtn) this.undoBtn.disabled = !canUndo;
        if (this.redoBtn) this.redoBtn.disabled = !canRedo;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Hilfsmethoden
    // ════════════════════════════════════════════════════════════════════════

    private highlightToolBtn(tool: 'pen' | 'eraser' | 'selection'): void {
        for (const [b, key] of [
            [this.penBtn, 'pen'], [this.eraserBtn, 'eraser'], [this.selectBtn, 'selection']
        ] as const) {
            if (!b) continue;
            const active = tool === key;
            b.style.background = active ? 'var(--interactive-accent)' : 'var(--background-primary)';
            b.style.color      = active ? 'var(--text-on-accent)'     : 'var(--text-normal)';
            b.style.borderColor = active ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
        }
    }

    private row(): HTMLElement {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex;align-items:center;gap:5px;flex-wrap:wrap;';
        return el;
    }

    private lbl(text: string): HTMLElement {
        const el = document.createElement('span');
        el.textContent = text;
        el.style.cssText = 'font-size:11px;color:var(--text-muted);user-select:none;white-space:nowrap;';
        return el;
    }

    private sep(): HTMLElement {
        const el = document.createElement('div');
        el.style.cssText = 'width:1px;height:20px;background:var(--background-modifier-border);margin:0 4px;flex-shrink:0;align-self:center;';
        return el;
    }

    private btn(icon: string, title: string, onClick: () => void): HTMLElement {
        const b = document.createElement('button');
        b.innerHTML = icon; b.title = title;
        b.style.cssText = 'padding:4px 8px;font-size:13px;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);color:var(--text-normal);cursor:pointer;white-space:nowrap;';
        b.onclick = (e) => { e.stopPropagation(); onClick(); };
        b.onmouseenter = () => { if (b.style.background !== 'var(--interactive-accent)') b.style.background = 'var(--background-modifier-hover)'; };
        b.onmouseleave = () => { if (b.style.background !== 'var(--interactive-accent)') b.style.background = 'var(--background-primary)'; };
        return b;
    }

    private rangeInput(min: number, max: number, step: number, value: number,
                       width: string, title: string): HTMLInputElement {
        const inp = document.createElement('input');
        inp.type  = 'range';
        inp.min   = String(min); inp.max = String(max); inp.step = String(step);
        inp.value = String(value);
        inp.style.width = width;
        inp.title = title;
        return inp;
    }

    private formatBtn(text: string, key: string, title: string,
                      fw: string, fi: string, active: boolean): HTMLElement {
        const b = document.createElement('button');
        b.textContent     = text; b.title = title; b.dataset.semantic = key;
        b.style.cssText   = 'padding:3px 7px;font-size:12px;border:1px solid var(--background-modifier-border);border-radius:4px;cursor:pointer;';
        b.style.fontWeight = fw; b.style.fontStyle = fi;
        this.applyFmtStyle(b, active);
        return b;
    }

    private applyFmtStyle(btn: HTMLElement, active: boolean): void {
        btn.style.background = active ? 'var(--interactive-accent)' : 'var(--interactive-normal)';
        btn.style.color      = active ? 'var(--text-on-accent)'     : 'var(--text-muted)';
    }

    private setActiveSemantic(semantic: string): void {
        this.formatBtns.forEach((b, k) => this.applyFmtStyle(b, k === semantic));
    }

    private getCurrentBlock(): Block | undefined {
        return this.context.blocks[this.context.currentBlockIndex];
    }

    private applyToSelected(cb: (block: Block) => void): void {
        if (this.context.blockManager.selectedBlockIndices.size === 0) {
            const b = this.getCurrentBlock(); if (b) cb(b);
        } else {
            this.context.blockManager.selectedBlockIndices.forEach(i => {
                const b = this.context.blocks[i]; if (b) cb(b);
            });
        }
    }

    private ensureBlockDS(block: Block): BlockDisplaySettings {
        if (!block.displaySettings) {
            const isH = block.type?.startsWith('heading') ?? false;
            const isQ = block.type === 'quote';
            block.displaySettings = {
                grid: { ...(this.context.document?.gridSettings ?? {
                    enabled: false, type: 'grid' as const,
                    size: 20, color: '#e0e0e0', opacity: 0.5, lineWidth: 0.5,
                })},
                useColor:        this.useColorForStyling,
                widthMultiplier: this.context.drawingManager?.widthMultiplier ?? 1.0,
                backgroundColor: '#ffffff',
                showSeparator:   isH,
                showQuoteBar:    isQ,
            };
        }
        return block.displaySettings;
    }

    private pushBlockRestyleHistory(apply: (b: Block) => Partial<BlockDisplaySettings>): void {
        const entries: Array<{ blockId: string; oldSettings: Partial<BlockDisplaySettings>; newSettings: Partial<BlockDisplaySettings> }> = [];

        const run = (block: Block) => {
            const old = block.displaySettings
                ? { useColor: block.displaySettings.useColor, backgroundColor: block.displaySettings.backgroundColor }
                : {};
            entries.push({ blockId: block.id, oldSettings: old, newSettings: apply(block) });
        };

        if (this.context.blockManager.selectedBlockIndices.size === 0) {
            const b = this.getCurrentBlock(); if (b) run(b);
        } else {
            this.context.blockManager.selectedBlockIndices.forEach(i => {
                const b = this.context.blocks[i]; if (b) run(b);
            });
        }

        if (entries.length > 0) this.context.historyManager?.push({ type: 'RESTYLE_BLOCK', entries });
    }
}