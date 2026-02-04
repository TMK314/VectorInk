import { BlockType, StrokeStyle } from '../types';
import { InkView } from './InkView';

export class StyleManager {
    private context: InkView;

    constructor(context: InkView) {
        this.context = context;
    }

    public getCalculatedStrokeStyle(blockType: BlockType, originalStyle: StrokeStyle): StrokeStyle {
        const isDrawing = blockType === 'drawing';

        if (isDrawing) {
            return {
                ...originalStyle,
                color: this.resolveCanvasColor(originalStyle.color)
            };
        }

        // Hole die Basisbreite für diesen Blocktyp
        let baseWidth: number;
        switch (blockType) {
            case 'paragraph': baseWidth = 2.0; break;
            case 'heading1': baseWidth = 5.0; break;
            case 'heading2': baseWidth = 4.0; break;
            case 'heading3': baseWidth = 3.5; break;
            case 'heading4': baseWidth = 3.0; break;
            case 'heading5': baseWidth = 2.5; break;
            case 'quote': baseWidth = 2.0; break;
            case 'math': baseWidth = 2.5; break;
            case 'table': baseWidth = 2.0; break;
            default: baseWidth = 2.0; break;
        }

        // Multiplikator anwenden
        baseWidth *= this.context.drawingManager?.widthMultiplier || 1.0;

        const style: StrokeStyle = {
            width: baseWidth,
            color: this.context.toolbarManager?.useColorForStyling
                ? this.resolveCanvasColor(originalStyle.color)
                : this.getThemeAdaptiveColor('#000000'),
            semantic: originalStyle.semantic,
            opacity: 1.0
        };

        // Formatierung anwenden
        if (originalStyle.semantic === 'bold') {
            style.width *= 1.5;
        } else if (originalStyle.semantic === 'italic') {
            style.width *= 0.7;
        }

        return style;
    }

    public getThemeAdaptiveColor(defaultColor: string): string {
        const isDarkTheme = this.isDarkTheme();
        return isDarkTheme ? '#ffffff' : '#000000';
    }

    public updateThemeColors(): void {
        const isDark = this.isDarkTheme();
        console.log('Theme changed. Is dark:', isDark);
        this.context.drawingManager?.redrawAllBlocks();
    }

    public setupThemeObserver(): void {
        // Entferne alten Observer, falls vorhanden
        const oldObserver = (this.context as any)._themeObserver;
        if (oldObserver) {
            oldObserver.disconnect();
        }

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    setTimeout(() => {
                        this.updateThemeBasedOnCurrent();
                    }, 100);
                }
            });
        });

        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });

        (this.context as any)._themeObserver = observer;
    }

    public isDarkTheme(): boolean {
        return document.body.classList.contains('theme-dark');
    }

    private updateThemeBasedOnCurrent(): void {
        const isDark = this.isDarkTheme();

        if (this.context.blocksContainer) {
            const canvases = this.context.blocksContainer.querySelectorAll('canvas');
            canvases.forEach(canvas => {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = isDark ? '#1a1a1a' : '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    const blockId = canvas.closest('.ink-block')?.getAttribute('data-block-id');
                    if (blockId) {
                        const block = this.context.blocks.find(b => b.id === blockId);
                        if (block) {
                            this.context.drawingManager?.drawBlockStrokes(canvas, block);
                        }
                    }
                }
            });
        }
    }

    private get useColorForStyling(): boolean {
        return this.context.toolbarManager?.useColorForStyling || true;
    }

    private resolveCanvasColor(color: string): string {
        if (!color) return '#000000';

        if (color.startsWith('var(')) {
            const varName = color.slice(4, -1).trim();
            const computed = getComputedStyle(document.body).getPropertyValue(varName);
            return computed.trim() || '#000000';
        }

        return color;
    }
}