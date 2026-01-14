// render/InkRenderer.ts
import { Stroke, Block } from '../schema';
import { InkDocument } from '../model/InkDocument';

export class InkRenderer {
    private container: HTMLElement;
    private svg: SVGElement;
    private defs: SVGDefsElement;
    private document: InkDocument;
    private scale: number = 1.0;
    private offset: { x: number, y: number } = { x: 0, y: 0 };

    constructor(container: HTMLElement, document: InkDocument) {
        this.container = container;
        this.document = document;
        this.setupSVG();
    }

    private setupSVG(): void {
        // Create SVG element
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.style.width = '100%';
        this.svg.style.height = '100%';
        this.svg.style.backgroundColor = this.document.pageSettings.backgroundColor;

        // Create defs for markers, patterns, etc.
        this.defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        this.svg.appendChild(this.defs);

        // Add grid pattern if enabled - check if grid exists
        if (this.document.pageSettings.grid && this.document.pageSettings.grid.enabled) {
            this.addGridPattern();
        }

        this.container.appendChild(this.svg);
    }

    private addGridPattern(): void {
        // First check if grid exists in pageSettings
        const pageSettings = this.document.pageSettings;
        if (!pageSettings || !pageSettings.grid || !pageSettings.grid.enabled) {
            return;
        }

        const gridSize = pageSettings.grid.size;
        const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        pattern.id = 'grid-pattern';
        pattern.setAttribute('patternUnits', 'userSpaceOnUse');
        pattern.setAttribute('width', gridSize.toString());
        pattern.setAttribute('height', gridSize.toString());

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${gridSize} 0 L 0 0 0 ${gridSize}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', pageSettings.grid.color);
        path.setAttribute('stroke-width', '0.5');

        pattern.appendChild(path);
        this.defs.appendChild(pattern);

        const gridRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        gridRect.setAttribute('width', '100%');
        gridRect.setAttribute('height', '100%');
        gridRect.setAttribute('fill', 'url(#grid-pattern)');
        this.svg.appendChild(gridRect);
    }

    async render(): Promise<void> {
        this.clear();

        // Render all strokes
        this.document.strokes.forEach(stroke => {
            this.renderStroke(stroke);
        });

        // Render block overlays (for selection)
        this.document.blocks.forEach(block => {
            this.renderBlockOverlay(block);
        });
    }

    renderStroke(stroke: Stroke): void {
        if (stroke.points.length < 2) return;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

        // Simplify points for display (optional)
        const displayPoints = this.simplifyPoints(stroke.points);

        // Build SVG path
        let d = `M ${displayPoints[0].x} ${displayPoints[0].y}`;
        for (let i = 1; i < displayPoints.length; i++) {
            d += ` L ${displayPoints[i].x} ${displayPoints[i].y}`;
        }

        path.setAttribute('d', d);
        path.setAttribute('stroke', stroke.style.color);
        path.setAttribute('stroke-width', stroke.style.width.toString());
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');

        // Add semantic styling
        if (stroke.style.semantic === 'highlight') {
            path.setAttribute('stroke-opacity', '0.3');
            path.setAttribute('stroke-width', (stroke.style.width * 3).toString());
        }

        path.dataset.strokeId = stroke.id;
        this.svg.appendChild(path);
    }

    renderBlockOverlay(block: any): void {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', block.bbox.x.toString());
        rect.setAttribute('y', block.bbox.y.toString());
        rect.setAttribute('width', block.bbox.width.toString());
        rect.setAttribute('height', block.bbox.height.toString());
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', '#3b82f6');
        rect.setAttribute('stroke-width', '1');
        rect.setAttribute('stroke-dasharray', '5,5');
        rect.setAttribute('opacity', '0.5');

        rect.dataset.blockId = block.id;
        this.svg.appendChild(rect);
    }

    private simplifyPoints(points: any[]): any[] {
        // Douglas-Peucker simplification
        const tolerance = 0.5;

        const douglasPeucker = (points: any[], tolerance: number): any[] => {
            if (points.length <= 2) return points;

            const line = {
                start: points[0],
                end: points[points.length - 1]
            };

            let maxDistance = 0;
            let maxIndex = 0;

            for (let i = 1; i < points.length - 1; i++) {
                const distance = this.perpendicularDistance(points[i], line);
                if (distance > maxDistance) {
                    maxDistance = distance;
                    maxIndex = i;
                }
            }

            if (maxDistance > tolerance) {
                const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
                const right = douglasPeucker(points.slice(maxIndex), tolerance);
                return left.slice(0, -1).concat(right);
            } else {
                return [points[0], points[points.length - 1]];
            }
        };

        return douglasPeucker(points, tolerance);
    }

    private perpendicularDistance(point: any, line: any): number {
        const { x: x1, y: y1 } = line.start;
        const { x: x2, y: y2 } = line.end;
        const { x, y } = point;

        const numerator = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1);
        const denominator = Math.sqrt(Math.pow(y2 - y1, 2) + Math.pow(x2 - x1, 2));

        return numerator / denominator;
    }

    clear(): void {
        // Remove all children except defs
        while (this.svg.children.length > 1) {
            this.svg.removeChild(this.svg.lastChild!);
        }
    }

    cleanup(): void {
        this.container.removeChild(this.svg);
    }
}