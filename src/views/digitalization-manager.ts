import { Block, Stroke } from '../types';
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
        if (!block.tableLines || block.tableLines.length === 0) {
            return `| Table with ${strokes.length} stroke${strokes.length !== 1 ? 's' : ''} |`;
        }

        // Sammle horizontale und vertikale Linien
        const horizontalLines = block.tableLines
            .filter(line => line.type === 'horizontal' && line.visible)
            .sort((a, b) => a.position - b.position);
        
        const verticalLines = block.tableLines
            .filter(line => line.type === 'vertical' && line.visible)
            .sort((a, b) => a.position - b.position);

        // Erstelle Zellengitter basierend auf Linien
        const rows: number[] = [0, ...horizontalLines.map(l => l.position), block.bbox.height];
        const cols: number[] = [0, ...verticalLines.map(l => l.position), block.bbox.width];

        // Zähle Strokes pro Zelle (vereinfachte Logik)
        const cellContents: string[][] = [];
        
        for (let i = 0; i < rows.length - 1; i++) {
            cellContents[i] = [];
            for (let j = 0; j < cols.length - 1; j++) {
                // Zähle Strokes in dieser Zelle (vereinfachte Positionprüfung)
                const strokesInCell = strokes.filter(stroke => {
                    const firstPoint = stroke.points[0];
                    if (!firstPoint) return false;
                    
                    if (cols[j] === undefined || cols[j + 1] === undefined ||
                        rows[i] === undefined || rows[i + 1] === undefined) {
                        return false;
                    }
                    return firstPoint.x >= cols[j]! && 
                           firstPoint.x <= cols[j + 1]! &&
                           firstPoint.y >= rows[i]! && 
                           firstPoint.y <= rows[i + 1]!;
                });
                
                if (cellContents[i] === undefined || typeof cellContents[i]![j] === undefined) {
                    return '';
                }
                cellContents[i]![j] = strokesInCell.length > 0 ? 'X' : '';
            }
        }

        // Erstelle Markdown-Tabelle
        let markdownTable = '';
        
        // Header (erste Zeile)
        markdownTable += '| ' + Array(cols.length - 1).fill('Cell').join(' | ') + ' |\n';
        
        // Trennlinie
        markdownTable += '|' + Array(cols.length - 1).fill('---').join('|') + '|\n';
        
        // Datenzeilen
        for (let i = 0; i < rows.length - 1; i++) {
            if (cellContents[i] === undefined) {
                continue;
            }
            markdownTable += '| ' + cellContents[i]!.join(' | ') + ' |\n';
        }

        return markdownTable.trim();
    }
}