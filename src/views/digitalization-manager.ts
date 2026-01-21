import { table } from 'console';
import { Block, Stroke, TableCell } from '../types';
import { InkView } from './InkView';
import { Notice } from 'obsidian';

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
}