import { Block, TableCell, Stroke, Point } from '../types';
import { CubicBezier } from "bezierFitting";
import { InkView } from '../views/InkView';
import { Notice } from 'obsidian';

export class LineDetection {
    /*
    Schritt 1
    Erstellen einer Bitmap
    */
    public createBitmapFromStrokes(strokes: Stroke[], resolution: number): number[][] {
        // 1. Bounding Box aller Striche berechnen
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const stroke of strokes) {
            for (const point of stroke.points) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            }
        }

        if (minX === Infinity) {
            return [[]];
        }

        const width = Math.ceil((maxX - minX) * resolution);
        const height = Math.ceil((maxY - minY) * resolution);
        const actualWidth = Math.max(1, width);
        const actualHeight = Math.max(1, height);

        const density: number[][] = Array.from({ length: actualHeight }, () => new Array(actualWidth).fill(0));

        const pointToCell = (x: number, y: number): [number, number] => {
            const col = Math.floor((x - minX) * resolution);
            const row = Math.floor((y - minY) * resolution);
            return [
                Math.min(Math.max(row, 0), actualHeight - 1),
                Math.min(Math.max(col, 0), actualWidth - 1)
            ];
        };

        const stepSize = 0.5 / resolution;

        const rasterizeLine = (x1: number, y1: number, x2: number, y2: number) => {
            const dist = Math.hypot(x2 - x1, y2 - y1);
            if (dist === 0) {
                const [row, col] = pointToCell(x1, y1);
                if (density[row] !== undefined) {
                    if (density[row][col] !== undefined)
                    {
                    density[row]![col] += 1;
                    }
                }
                return;
            }
            const numSteps = Math.ceil(dist / stepSize);
            for (let i = 0; i <= numSteps; i++) {
                const t = i / numSteps;
                const x = x1 + (x2 - x1) * t;
                const y = y1 + (y2 - y1) * t;
                const [row, col] = pointToCell(x, y);
                if (density[row] !== undefined) {
                    if (density[row][col] !== undefined)
                    {
                    density[row]![col] += 1;
                    }
                }
            }
        };

        // Auswertung einer kubischen Bezier-Kurve (bleibt unverändert)
        const evaluateCubicBezier = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
            const mt = 1 - t;
            const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x;
            const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y;
            return { x, y, t: 0 };
        };

        // Alle Striche verarbeiten (unverändert, nur Aufrufe von rasterizeLine sind jetzt korrigiert)
        for (const stroke of strokes) {
            if (stroke.bezierCurves && stroke.bezierCurves.length > 0) {
                for (const curve of stroke.bezierCurves) {
                    const bezier = curve as any;
                    const p0 = bezier.p0 ?? bezier.start;
                    const p1 = bezier.p1 ?? bezier.control1;
                    const p2 = bezier.p2 ?? bezier.control2;
                    const p3 = bezier.p3 ?? bezier.end;

                    if (p0 && p1 && p2 && p3) {
                        const numSegments = 20;
                        const points: Point[] = [];
                        for (let i = 0; i <= numSegments; i++) {
                            const t = i / numSegments;
                            points.push(evaluateCubicBezier(p0, p1, p2, p3, t));
                        }
                        for (let i = 0; i < points.length - 1; i++) {
                            if (points[i] && points[i + 1])
                                rasterizeLine(points[i]!.x, points[i]!.y, points[i + 1]!.x, points[i + 1]!.y);
                        }
                    } else {
                        console.warn("CubicBezier-Struktur unbekannt – verwende originale Punkte");
                        const pts = stroke.points;
                        for (let i = 0; i < pts.length - 1; i++) {
                            if (pts[i] && pts[i + 1])
                                rasterizeLine(pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y);
                        }
                    }
                }
            } else {
                const pts = stroke.points;
                for (let i = 0; i < pts.length - 1; i++) {
                    if (pts[i] && pts[i + 1])
                        rasterizeLine(pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y);
                }
            }
        }

        return density;
    }
}