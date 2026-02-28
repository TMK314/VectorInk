import { Block, Stroke, TableCell, BlockType } from '../types';
import { InkView } from './InkView';
import { Notice } from 'obsidian';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import VectorInkPlugin from '../main';

const execFilePromise = promisify(execFile);

export class DigitalizationManager {
    private context: InkView;
    private plugin: VectorInkPlugin;

    constructor(context: InkView) {
        this.context = context;
        this.plugin = context.plugin;
    }

    /**
     * Hauptmethode: Digitalisiert das gesamte Dokument.
     */
    public async digitalizeCurrentDocument(): Promise<void> {
        try {
            if (!this.context.document || !this.context.file) {
                new Notice('No document to digitalize');
                return;
            }

            let markdownContent = '';

            const blocks = [...this.context.blocks].sort((a, b) => a.order - b.order);
            const textBlockTypes: BlockType[] = ['paragraph', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'quote', 'math'];

            for (const block of blocks) {
                let blockContent = '';
                try {
                    if (textBlockTypes.includes(block.type)) {
                        blockContent = await this.digitalizeBlockWithOCR(block);
                    } else {
                        blockContent = this.digitalizeBlock(block);
                    }
                } catch (error) {
                    console.error('Error processing block', block.id, error);
                    blockContent = `*[Error in block ${block.id}: ${error instanceof Error ? error.message : 'unknown error'}]*`;
                }
                if (blockContent) {
                    markdownContent += blockContent + '\n\n';
                }
            }

            const inkFilePath = this.context.file.path;
            const startComment = `%% VectorInk: ${inkFilePath} start %%`;
            const endComment = `%% VectorInk: ${inkFilePath} end %%`;

            const fullContent = `${startComment}\n\n${markdownContent}\n${endComment}`;

            const mdFileName = this.context.file.basename + '.md';
            const mdFilePath = this.context.file.path.replace(/\.ink$/, '.md');

            const adapter = (this.context.app.vault as unknown as { adapter: any }).adapter;
            const exists = await adapter.exists(mdFilePath);

            if (exists) {
                const existingContent = await adapter.read(mdFilePath);
                const regex = new RegExp(`%% VectorInk: ${inkFilePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} start %%.*?%% VectorInk: ${inkFilePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} end %%`, 's');

                if (regex.test(existingContent)) {
                    const newContent = existingContent.replace(regex, fullContent);
                    await adapter.write(mdFilePath, newContent);
                } else {
                    await adapter.write(mdFilePath, existingContent + '\n\n' + fullContent);
                }
            } else {
                await adapter.write(mdFilePath, fullContent);
            }

            new Notice(`Digitalized to: ${mdFileName}`);

        } catch (error) {
            console.error('Digitalization error:', error);
            new Notice('Failed to digitalize document: ' + (error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * Digitalisiert einen Block mittels OCR.
     */
    private async digitalizeBlockWithOCR(block: Block): Promise<string> {
        try {
            const { imagePath, minX, minY, padding } = await this.renderBlockToImage(block);
            const ocrResults = await this.runOCR(imagePath);
            fs.unlinkSync(imagePath); // Temporäre Datei löschen

            if (ocrResults.length === 0) {
                return ''; // Nichts erkannt
            }

            const strokes = block.strokeIds
                .map(id => this.context.document!.getStroke(id))
                .filter((s): s is Stroke => s !== undefined);

            // OCR-Ergebnisse in Weltkoordinaten umrechnen und Stile zuordnen
            const words = ocrResults.map((item: any) => {
                const box = item.box;
                const xs = box.map((p: number[]) => p[0]);
                const ys = box.map((p: number[]) => p[1]);
                const minXpx = Math.min(...xs);
                const maxXpx = Math.max(...xs);
                const minYpx = Math.min(...ys);
                const maxYpx = Math.max(...ys);

                const worldMinX = minXpx + minX - padding;
                const worldMaxX = maxXpx + minX - padding;
                const worldMinY = minYpx + minY - padding;
                const worldMaxY = maxYpx + minY - padding;

                return {
                    text: item.text,
                    confidence: item.confidence,
                    bbox: {
                        x: worldMinX,
                        y: worldMinY,
                        width: worldMaxX - worldMinX,
                        height: worldMaxY - worldMinY
                    }
                };
            });

            const wordStyles = words.map(word => {
                const overlappingStrokes = strokes.filter(stroke => {
                    let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
                    for (const p of stroke.points) {
                        sMinX = Math.min(sMinX, p.x);
                        sMinY = Math.min(sMinY, p.y);
                        sMaxX = Math.max(sMaxX, p.x);
                        sMaxY = Math.max(sMaxY, p.y);
                    }
                    return !(sMaxX < word.bbox.x || sMinX > word.bbox.x + word.bbox.width ||
                        sMaxY < word.bbox.y || sMinY > word.bbox.y + word.bbox.height);
                });

                let bold = false;
                let italic = false;
                const colors: string[] = [];
                overlappingStrokes.forEach(s => {
                    if (s.style.semantic === 'bold') bold = true;
                    if (s.style.semantic === 'italic') italic = true;
                    colors.push(s.style.color);
                });

                const colorCounts = new Map<string, number>();
                colors.forEach(c => colorCounts.set(c, (colorCounts.get(c) || 0) + 1));
                let dominantColor = '';
                let maxCount = 0;
                colorCounts.forEach((count, color) => {
                    if (count > maxCount) {
                        maxCount = count;
                        dominantColor = color;
                    }
                });

                return {
                    text: word.text,
                    bbox: word.bbox,
                    bold,
                    italic,
                    color: dominantColor
                };
            });

            // Nach Position sortieren
            wordStyles.sort((a, b) => {
                if (Math.abs(a.bbox.y - b.bbox.y) < 15) {
                    return a.bbox.x - b.bbox.x;
                }
                return a.bbox.y - b.bbox.y;
            });

            // In Zeilen gruppieren
            const lines: typeof wordStyles[] = [];
            let currentLine: typeof wordStyles = [];
            let lastY = -1000;
            for (const w of wordStyles) {
                if (currentLine.length === 0 || Math.abs(w.bbox.y - lastY) < 15) {
                    currentLine.push(w);
                    lastY = w.bbox.y;
                } else {
                    lines.push(currentLine);
                    currentLine = [w];
                    lastY = w.bbox.y;
                }
            }
            if (currentLine.length > 0) lines.push(currentLine);

            // Markdown für jede Zeile erstellen
            const lineTexts = lines.map(line => {
                return line.map(w => {
                    let text = w.text;

                    if (w.bold && w.italic) {
                        text = `***${text}***`;
                    } else if (w.bold) {
                        text = `**${text}**`;
                    } else if (w.italic) {
                        text = `*${text}*`;
                    }

                    if (w.color && w.color !== '#000000' && w.color !== '#000') {
                        text = `<span style="color: ${w.color}">${text}</span>`;
                    }

                    return text;
                }).join(' ');
            });

            const blockText = lineTexts.join('\n');

            switch (block.type) {
                case 'heading1': return '# ' + blockText;
                case 'heading2': return '## ' + blockText;
                case 'heading3': return '### ' + blockText;
                case 'heading4': return '#### ' + blockText;
                case 'heading5': return '##### ' + blockText;
                case 'quote': return '> ' + blockText;
                case 'math': return '$$ ' + blockText + ' $$';
                case 'paragraph':
                default: return blockText;
            }

        } catch (error) {
            console.error('Error digitalizing block:', error);
            // Fehler als Kommentar im Markdown sichtbar machen
            return `*[OCR error: ${error instanceof Error ? error.message : 'unknown error'}]*`;
        }
    }

    /**
     * Rendert die Strokes eines Blocks als PNG und speichert es temporär.
     */
    private async renderBlockToImage(block: Block): Promise<{ imagePath: string; minX: number; minY: number; padding: number }> {
        if (!this.context.document) throw new Error('No document');

        const strokes = block.strokeIds
            .map(id => this.context.document!.getStroke(id))
            .filter((s): s is Stroke => s !== undefined);

        if (strokes.length === 0) throw new Error('No strokes in block');

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const stroke of strokes) {
            for (const p of stroke.points) {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            }
        }

        const padding = 20;
        const width = Math.ceil(maxX - minX) + 2 * padding;
        const height = Math.ceil(maxY - minY) + 2 * padding;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        for (const stroke of strokes) {
            ctx.beginPath();
            ctx.strokeStyle = stroke.style.color;
            ctx.lineWidth = stroke.style.width;
            if (stroke.style.opacity !== undefined) {
                ctx.globalAlpha = stroke.style.opacity;
            }

            const first = stroke.points[0];
            if (!first) continue;
            ctx.moveTo(first.x - minX + padding, first.y - minY + padding);

            for (let i = 1; i < stroke.points.length; i++) {
                const p = stroke.points[i];
                if (!p) continue;
                ctx.lineTo(p.x - minX + padding, p.y - minY + padding);
            }
            ctx.stroke();
        }

        const tempDir = os.tmpdir();
        const tempFileName = `ink_ocr_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
        const tempPath = path.join(tempDir, tempFileName);

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Failed to create blob'));
            }, 'image/png');
        });

        const buffer = Buffer.from(await blob.arrayBuffer());
        fs.writeFileSync(tempPath, buffer);

        return { imagePath: tempPath, minX, minY, padding };
    }

    /**
     * Ruft das Python-Skript für OCR auf.
     * Verwendet den Vault-Pfad und die Plugin-ID, um ocr_helper.py zu finden.
     */
    private async runOCR(imagePath: string): Promise<any[]> {

        // Python aus Settings
        const pythonCmd = this.plugin.settings.pythonPath || "python";

        // Vault-Pfad
        // @ts-ignore
        const vaultPath = this.context.app.vault.adapter.getBasePath();

        // @ts-ignore
        const manifest = this.plugin.manifest;
        const pluginId = manifest?.id || "vector-ink";

        const pluginFolder = path.join(vaultPath, ".obsidian", "plugins", pluginId);
        const scriptPath = path.join(pluginFolder, "ocr_helper.py");

        if (!fs.existsSync(scriptPath)) {
            throw new Error(`ocr_helper.py not found at ${scriptPath}`);
        }

        try {
            const { stdout, stderr } = await execFilePromise(
                pythonCmd,
                [scriptPath, imagePath, "--lang", "de"]
            );

            if (stderr) console.error("OCR stderr:", stderr);

            return JSON.parse(stdout);

        } catch (error: any) {

            let message = "OCR failed. ";

            if (error.code === "ENOENT") {
                message += `Python executable not found: ${pythonCmd}`;
            } else {
                message += error.message || "Unknown error.";
            }

            throw new Error(message);
        }
    }

    // ------------------------------------------------------------------------
    // Bestehende Methoden (Fallback für Tabellen etc.)
    // ------------------------------------------------------------------------

    private digitalizeBlock(block: Block): string {
        if (!this.context.document) return '';

        const strokes = block.strokeIds
            .map(id => this.context.document!.getStroke(id))
            .filter((s): s is Stroke => s !== undefined);

        if (strokes.length === 0) return '';

        let content = '';
        const strokeCount = strokes.length;

        switch (block.type) {
            case 'paragraph':
                content = `Paragraph with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'heading1':
                content = `# Heading with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'heading2':
                content = `## Heading with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'heading3':
                content = `### Heading with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'heading4':
                content = `#### Heading with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'heading5':
                content = `##### Heading with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'math':
                content = `$$ Math content with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}. $$`;
                break;
            case 'quote':
                content = `> Quote with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}.`;
                break;
            case 'drawing':
                content = `![Drawing with ${strokeCount} stroke${strokeCount !== 1 ? 's' : ''}](${this.context.file?.basename}.ink)`;
                break;
            case 'table':
                content = this.digitalizeTableBlock(block, strokes);
                break;
        }

        const hasBold = strokes.some(s => s.style.semantic === 'bold');
        const hasItalic = strokes.some(s => s.style.semantic === 'italic');

        if (hasBold && hasItalic) {
            content = `***${content}***`;
        } else if (hasBold) {
            content = `**${content}**`;
        } else if (hasItalic) {
            content = `*${content}*`;
        }

        return content;
    }

    private digitalizeTableBlock(block: Block, strokes: Stroke[]): string {
        if (!block.tableGrid) {
            return `| Table with ${strokes.length} stroke${strokes.length !== 1 ? 's' : ''} |`;
        }

        const grid = block.tableGrid;
        const tableContent: string[][] = [];

        for (let row = 0; row < grid.rows; row++) {
            tableContent[row] = [];
            for (let col = 0; col < grid.cols; col++) {
                tableContent[row]![col] = '';
            }
        }

        strokes.forEach(stroke => {
            if (stroke.points.length === 0) return;
            const center = this.calculateStrokeCenter(stroke);
            const cell = this.findContainingCell(block, center);
            if (cell) {
                const row = cell.row;
                const col = cell.col;
                if (tableContent[row] === undefined) {
                    tableContent[row] = [];
                }
                if (tableContent[row][col] === '') {
                    tableContent[row][col] = '✎';
                } else {
                    tableContent[row][col] += '✎';
                }
            }
        });

        grid.cells.forEach(cell => {
            if (cell.rowSpan > 1 || cell.colSpan > 1) {
                for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
                    for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
                        if (r === cell.row && c === cell.col) continue;
                        if (!tableContent[cell.row] || !tableContent[r] || tableContent[cell.row]![cell.col] === undefined || tableContent[r]![c] === undefined) continue;
                        if (tableContent[r]![c]) {
                            tableContent[cell.row]![cell.col]! += tableContent[r]![c];
                            tableContent[r]![c] = '';
                        }
                    }
                }
            }
        });

        let markdownTable = '';
        markdownTable += '| ' + Array(grid.cols).fill(' ').join(' | ') + ' |\n';
        markdownTable += '|' + Array(grid.cols).fill('---').join('|') + '|\n';

        for (let row = 0; row < grid.rows; row++) {
            const rowContent = [];
            for (let col = 0; col < grid.cols; col++) {
                const cell = grid.cells.find(c => c.row === row && c.col === col);
                if (cell && (cell.rowSpan > 1 || cell.colSpan > 1)) {
                    if (cell.row === row && cell.col === col) {
                        rowContent.push(tableContent[row]?.[col] || ' ');
                    } else {
                        rowContent.push('');
                    }
                } else {
                    rowContent.push(tableContent[row]?.[col] || ' ');
                }
            }
            markdownTable += '| ' + rowContent.join(' | ') + ' |\n';
        }

        return markdownTable.trim();
    }

    private calculateStrokeCenter(stroke: Stroke): { x: number; y: number } {
        if (stroke.points.length === 0) return { x: 0, y: 0 };
        let sumX = 0, sumY = 0;
        for (const p of stroke.points) {
            sumX += p.x;
            sumY += p.y;
        }
        return { x: sumX / stroke.points.length, y: sumY / stroke.points.length };
    }

    private findContainingCell(block: Block, point: { x: number; y: number }): TableCell | null {
        if (!block.tableGrid) return null;
        const grid = block.tableGrid;
        let currentY = 0;
        for (let row = 0; row < grid.rows; row++) {
            let currentX = 0;
            const rowHeight = grid.rowHeights[row];
            for (let col = 0; col < grid.cols; col++) {
                const colWidth = grid.colWidths[col];
                if (colWidth === undefined || rowHeight === undefined) {
                    currentX += colWidth || 0;
                    continue;
                }
                if (point.x >= currentX && point.x <= currentX + colWidth &&
                    point.y >= currentY && point.y <= currentY + rowHeight) {
                    const cell = grid.cells.find(c =>
                        c.row <= row && row < c.row + c.rowSpan &&
                        c.col <= col && col < c.col + c.colSpan
                    );
                    return cell || null;
                }
                currentX += colWidth;
            }
            if (rowHeight === undefined) continue;
            currentY += rowHeight;
        }
        return null;
    }
}