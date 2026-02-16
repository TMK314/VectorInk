import { table } from 'console';
import { Block, Stroke, TableCell } from '../types';
import { InkView } from './InkView';
import { Notice } from 'obsidian';
import { LineDetection } from '../ocr/LineDetection';

export class DigitalizationManager {
    private context: InkView;

    constructor(context: InkView) {
        this.context = context;
    }

    public async digitalizeCurrentDocument(): Promise<void> {
        try {
            if (!this.context.document || !this.context.file) {
                new Notice('No document to digitalize');
                return;
            }

            let markdownContent = '';

            // Dichtemap
            for (const block of this.context.blocks.sort((a, b) => a.order - b.order)) {
                const blockStrokes = block.strokeIds
                    .map(id => this.context.document!.getStroke(id))
                    .filter((s): s is Stroke => s !== undefined);

                const resolution = 7.5 * 0.01; // experimentell
                const horizontalMergeWorldDistance = 50; // experimentell, je nach Schriftgröße anpassen
                const horizontalMergeRadius = Math.ceil(horizontalMergeWorldDistance * resolution);
                const lineDetection = new LineDetection();

                const bitmapResult = lineDetection.createBitmapFromStrokes(
                    blockStrokes,
                    resolution,
                    horizontalMergeRadius   // jetzt mit Filter
                );
                const bitmap = bitmapResult.density;

                // Dichte-Bitmap zeichnen (optional)
                this.context.drawBitmapForBlock(block, bitmap, resolution, bitmapResult.minX, bitmapResult.minY);

                const gapThreshold = 0.8; // in Weltkoordinaten, je nach Schriftgröße anpassen
                const startRowCandidates = this.getSeparatorStartRowsFromStrokes(
                    blockStrokes,
                    bitmapResult.minY,
                    resolution,
                    gapThreshold
                );

                // Trennlinien-Pfade finden
                const paths = lineDetection.findSeparatorPaths(
                    bitmap,
                    bitmapResult.minX,          // ← jetzt korrekte Werte
                    bitmapResult.minY,
                    resolution,
                    0.002,   // thresholdFactor
                    2,       // minGapRows
                    0.01,       // costPerStep
                    0.5,      // densityWeight – reduziert, um auch schräge Pfade zu ermöglichen
                    startRowCandidates,
                    5
                );

                // Pfade zeichnen (verschiedene Farben für verschiedene Pfade)
                const colors = ['blue', 'green', 'orange', 'purple', 'red'];
                paths.forEach((path, index) => {
                    this.context.drawPath(block, path.points, 'blue', true);
                });

                // Markdown-Inhalt generieren (unverändert)
                const blockContent = this.digitalizeBlock(block);
                if (blockContent) {
                    markdownContent += blockContent + '\n\n';
                }
            }

            for (const block of this.context.blocks.sort((a, b) => a.order - b.order)) {
                const blockContent = this.digitalizeBlock(block);
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

            try {
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
                console.error('Error creating/updating markdown file:', error);
                new Notice('Error digitalizing document');
            }

        } catch (error) {
            console.error('Digitalization error:', error);
            new Notice('Failed to digitalize document');
        }
    }

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

        // Initialisiere leere Zellen
        for (let row = 0; row < grid.rows; row++) {
            tableContent[row] = [];
            for (let col = 0; col < grid.cols; col++) {
                if (tableContent[row] !== undefined) {
                    tableContent[row]![col] = '';
                }
            }
        }

        // Finde für jeden Stroke die Hauptzelle
        strokes.forEach(stroke => {
            if (stroke.points.length === 0) return;

            // Berechne den Schwerpunkt des Strokes
            const center = this.calculateStrokeCenter(stroke);

            // Finde die Zelle, die den Schwerpunkt enthält
            const cell = this.findContainingCell(block, center);
            if (cell) {
                // Füge dem Zelleninhalt hinzu (vereinfacht)
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

        // Berücksichtige Zellen-Spans
        grid.cells.forEach(cell => {
            if (cell.rowSpan > 1 || cell.colSpan > 1) {
                // Merge-Zelle - Content in die obere linke Zelle verschieben
                for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
                    for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
                        if (r === cell.row && c === cell.col) continue;
                        if (tableContent[cell.row] === undefined || tableContent[cell.row] === undefined || tableContent[r] === undefined) continue;
                        if (tableContent[cell.row]![cell.col] === undefined || tableContent[r]![c] === undefined) continue;
                        if (tableContent[r] && tableContent[r]![c]) {
                            tableContent[cell.row]![cell.col]! += tableContent[r]![c];
                            tableContent[r]![c] = '';
                        }
                    }
                }
            }
        });

        // Erstelle Markdown-Tabelle
        let markdownTable = '';

        // Header
        markdownTable += '| ' + Array(grid.cols).fill(' ').join(' | ') + ' |\n';

        // Trennlinie
        markdownTable += '|' + Array(grid.cols).fill('---').join('|') + '|\n';

        // Datenzeilen
        for (let row = 0; row < grid.rows; row++) {
            const rowContent = [];
            for (let col = 0; col < grid.cols; col++) {
                const cell = grid.cells.find(c => c.row === row && c.col === col);
                if (cell && (cell.rowSpan > 1 || cell.colSpan > 1)) {
                    // Für Merge-Zellen
                    if (cell.row === row && cell.col === col) {
                        if (tableContent[row] === undefined) {
                            tableContent[row] = [];
                        }
                        rowContent.push(tableContent[row]![col] || ' ');
                    } else {
                        rowContent.push(''); // Leere Zellen für Merge
                    }
                } else {
                    if (tableContent[row] === undefined) {
                        tableContent[row] = [];
                    }
                    rowContent.push(tableContent[row]![col] || ' ');
                }
            }
            markdownTable += '| ' + rowContent.join(' | ') + ' |\n';
        }

        return markdownTable.trim();
    }

    private calculateStrokeCenter(stroke: Stroke): { x: number, y: number } {
        if (stroke.points.length === 0) return { x: 0, y: 0 };

        let sumX = 0;
        let sumY = 0;

        for (const point of stroke.points) {
            sumX += point.x;
            sumY += point.y;
        }

        return {
            x: sumX / stroke.points.length,
            y: sumY / stroke.points.length
        };
    }

    private findContainingCell(block: Block, point: { x: number, y: number }): TableCell | null {
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

                // Prüfe, ob Punkt in dieser Basis-Zelle ist
                if (point.x >= currentX && point.x <= currentX + colWidth &&
                    point.y >= currentY && point.y <= currentY + rowHeight) {

                    // Finde die tatsächliche Zelle (mit Spans)
                    const cell = grid.cells.find(c => {
                        return c.row <= row && row < c.row + c.rowSpan &&
                            c.col <= col && col < c.col + c.colSpan;
                    });

                    return cell || null;
                }

                currentX += colWidth;
            }

            if (rowHeight === undefined) continue;
            currentY += rowHeight;
        }

        return null;
    }

    /**
 * Ermittelt Start-Y-Positionen (in Bitmap-Zeilen) für Trennlinien basierend auf Strich-Clustering.
 * @param strokes - Liste der Striche im Block
 * @param minY - minimale y-Koordinate der Bounding Box (Welt)
 * @param resolution - Auflösung der Bitmap
 * @param gapThreshold - maximaler vertikaler Abstand zwischen zwei Strichen, um noch zur selben Zeile zu gehören (in Weltkoordinaten)
 * @returns Array von Zeilenindizes (in Bitmap-Koordinaten), die als Startpunkte für die Pfadsuche dienen
 */
    private getSeparatorStartRowsFromStrokes(
        strokes: Stroke[],
        minY: number,
        resolution: number,
        gapThreshold: number = 0.8 // in Weltkoordinaten, z.B. 0.8 cm
    ): number[] {
        if (strokes.length === 0) return [];

        // Für jeden Strich die y-Ausdehnung berechnen
        const strokeInfos = strokes
            .map(stroke => {
                if (stroke.points.length === 0) return null;
                let minY = Infinity, maxY = -Infinity;
                for (const p of stroke.points) {
                    minY = Math.min(minY, p.y);
                    maxY = Math.max(maxY, p.y);
                }
                return { minY, maxY };
            })
            .filter(info => info !== null) as { minY: number; maxY: number }[];

        if (strokeInfos.length === 0) return [];

        // Sortieren nach der oberen Kante (minY)
        strokeInfos.sort((a, b) => a.minY - b.minY);

        // Cluster bilden
        const clusters: { minY: number; maxY: number }[] = [];
        if (strokeInfos[0] === undefined) return [];
        let currentCluster = { minY: strokeInfos[0].minY, maxY: strokeInfos[0].maxY };

        for (let i = 1; i < strokeInfos.length; i++) {
            const info = strokeInfos[i];
            if (info === undefined) continue;
            const gap = info.minY - currentCluster.maxY; // Lücke zwischen den Bounding-Boxen
            if (gap <= gapThreshold) {
                // Gehört zur gleichen Zeile
                currentCluster.maxY = Math.max(currentCluster.maxY, info.maxY);
                currentCluster.minY = Math.min(currentCluster.minY, info.minY); // optional
            } else {
                // Neue Zeile
                clusters.push(currentCluster);
                currentCluster = { minY: info.minY, maxY: info.maxY };
            }
        }
        clusters.push(currentCluster);

        // Trennlinien zwischen den Clustern
        const separatorRows: number[] = [];
        for (let i = 0; i < clusters.length - 1; i++) {
            const upper = clusters[i];
            const lower = clusters[i + 1];
            if (upper === undefined || lower === undefined) continue;
            const gapMidY = (upper.maxY + lower.minY) / 2; // Mitte der Lücke
            const row = Math.floor((gapMidY - minY) * resolution);
            separatorRows.push(row);
        }

        return separatorRows;
    }
}