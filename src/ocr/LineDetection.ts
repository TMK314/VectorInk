import { Block, TableCell, Stroke, Point } from '../types';
import { CubicBezier } from "bezierFitting";
import { InkView } from '../views/InkView';
import { Notice } from 'obsidian';

interface AStarNode {
    x: number;      // Spaltenindex (0..width-1)
    y: number;      // Zeilenindex (0..height-1)
    g: number;      // Kosten vom Start
    h: number;      // Heuristik zum Ziel
    f: number;      // g + h
    parent: AStarNode | null;
}

interface PathResult {
    points: Point[];           // Pfad in Weltkoordinaten (Mitte der Zellen)
    cost: number;              // Gesamtkosten (für Vergleiche)
    startY: number;            // Start-y (Bitmap-Zeile)
}

export interface BitmapResult {
    density: number[][];
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export class LineDetection {
    /*
    Schritt 1
    Erstellen einer Bitmap
    */
    public createBitmapFromStrokes(strokes: Stroke[], resolution: number): BitmapResult {
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
            return { density: [[]], minX: 0, minY: 0, maxX: 0, maxY: 0 };
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
                    if (density[row][col] !== undefined) {
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
                    if (density[row][col] !== undefined) {
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

        return { density, minX, minY, maxX, maxY };
    }

    /**
     * Findet mehrere Trennlinien-Pfade zwischen Zeilen mittels A*.
     * @param density - Dichtematrix (row, col)
     * @param minX - minimale x-Koordinate der Bounding Box (Welt)
     * @param minY - minimale y-Koordinate der Bounding Box (Welt)
     * @param resolution - Auflösung (Pixel pro Einheit)
     * @param thresholdFactor - Faktor für die horizontale Projektion zur Bestimmung der Startpunkte (default 0.05)
     * @param minGapRows - Mindesthöhe einer Lücke in Bitmap-Zeilen (default 3)
     * @param costPerStep - Basiskosten pro Schritt (default 1)
     * @param densityWeight - Gewichtung der Zelldichte in den Kosten (default 1)
     * @returns Array von Pfaden (jeweils Punkte in Weltkoordinaten)
     */
    public findSeparatorPaths(
        density: number[][],
        minX: number,
        minY: number,
        resolution: number,
        thresholdFactor: number = 0.05,
        minGapRows: number = 3,
        costPerStep: number = 1,
        densityWeight: number = 1
    ): PathResult[] {
        const height = density.length;
        if (density[0] === undefined) return [];
        const width = height > 0 ? density[0].length : 0;
        if (height === 0 || width === 0) return [];

        // Horizontale Projektion
        const rowSums: number[] = new Array(height).fill(0);
        for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
                if (density[r] === undefined) continue;
                if (density[r]![c] === undefined) continue;
                if (rowSums[r] === undefined) continue;
                rowSums[r]! += density[r]![c]!;
            }
        }

        const maxSum = Math.max(...rowSums);
        const threshold = maxSum * thresholdFactor;

        const gaps: { start: number; end: number }[] = [];
        let inGap = false;
        let gapStart = 0;
        for (let r = 0; r < height; r++) {
            if (rowSums[r] === undefined) continue;
            const isGap = rowSums[r]! < threshold;
            if (isGap && !inGap) {
                inGap = true;
                gapStart = r;
            } else if (!isGap && inGap) {
                inGap = false;
                gaps.push({ start: gapStart, end: r - 1 });
            }
        }
        if (inGap) gaps.push({ start: gapStart, end: height - 1 });

        const significantGaps = gaps.filter(gap => (gap.end - gap.start + 1) >= minGapRows);
        const startCandidates = significantGaps.map(gap => Math.floor((gap.start + gap.end) / 2));

        const paths: PathResult[] = [];

        for (const startY of startCandidates) {
            const path = this.aStarSearch(density, startY, width, height, costPerStep, densityWeight);
            if (path) {
                // Pfad in Weltkoordinaten konvertieren – Point[] mit t=0 (wird nicht benötigt, aber Typ verlangt es)
                const worldPoints: Point[] = path.map(([col, row]) => ({
                    x: minX + (col + 0.5) / resolution,
                    y: minY + (row + 0.5) / resolution,
                    t: 0
                }));
                const cost = this.calculatePathCost(density, path, costPerStep, densityWeight);
                paths.push({ points: worldPoints, cost, startY });
            }
        }

        console.log("Paths: ", paths);
        // Gruppierung ähnlicher Pfade
        const groupedPaths = this.groupSimilarPaths(paths, 2);// height / 20);
        return groupedPaths;
    }

    /**
     * A*-Suche von linker Spalte (0) bei gegebener Startzeile zur rechten Spalte (width-1).
     * @returns Array von [col, row] für den Pfad (inklusive Start und Ziel) oder null, wenn kein Pfad.
     */
    private aStarSearch(
        density: number[][],
        startY: number,
        width: number,
        height: number,
        costPerStep: number,
        densityWeight: number
    ): [number, number][] | null {
        const openSet: AStarNode[] = [];
        const closedSet = new Set<string>();
        const startNode: AStarNode = {
            x: 0,
            y: startY,
            g: 0,
            h: this.heuristic(0, startY, width - 1, startY),
            f: 0,
            parent: null
        };
        startNode.f = startNode.g + startNode.h;
        openSet.push(startNode);

        const nodeMap = new Map<string, AStarNode>();
        nodeMap.set(`0,${startY}`, startNode);

        while (openSet.length > 0) {
            openSet.sort((a, b) => a.f - b.f);
            const current = openSet.shift();
            if (!current) continue; // Sicherheitscheck

            const key = `${current.x},${current.y}`;
            if (closedSet.has(key)) continue;
            closedSet.add(key);

            if (current.x === width - 1) {
                // Pfad rekonstruieren
                const path: [number, number][] = [];
                let node: AStarNode | null = current;
                while (node) {
                    path.unshift([node.x, node.y]);
                    node = node.parent;
                }
                return path;
            }

            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = current.x + dx;
                    const ny = current.y + dy;
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                    const neighborKey = `${nx},${ny}`;
                    if (closedSet.has(neighborKey)) continue;

                    const moveCost = Math.hypot(dx, dy) * costPerStep;
                    if (density[ny] === undefined) continue;
                    if (density[ny][nx] === undefined) continue;
                    const densityCost = density[ny][nx] * densityWeight;
                    const tentativeG = current.g + moveCost + densityCost;

                    let neighbor = nodeMap.get(neighborKey);
                    if (!neighbor) {
                        neighbor = {
                            x: nx,
                            y: ny,
                            g: tentativeG,
                            h: width - 1 - nx,
                            f: 0,
                            parent: current
                        };
                        neighbor.f = neighbor.g + neighbor.h;
                        nodeMap.set(neighborKey, neighbor);
                        openSet.push(neighbor);
                    } else if (tentativeG < neighbor.g) {
                        neighbor.g = tentativeG;
                        neighbor.f = neighbor.g + neighbor.h;
                        neighbor.parent = current;
                    }
                }
            }
        }
        return null;
    }

    private heuristic(x1: number, y1: number, x2: number, y2: number): number {
        // Euklidische Distanz (Heuristik sollte zulässig sein)
        return Math.hypot(x2 - x1, y2 - y1);
    }

    private calculatePathCost(
        density: number[][],
        path: [number, number][],
        costPerStep: number,
        densityWeight: number
    ): number {
        let cost = 0;
        for (let i = 0; i < path.length - 1; i++) {
            const p1 = path[i];
            const p2 = path[i + 1];
            // Explizite Prüfung auf undefined (obwohl es innerhalb der Schleife immer definiert sein sollte)
            if (p1 && p2) {
                const [x1, y1] = p1;
                const [x2, y2] = p2;
                const stepCost = Math.hypot(x2 - x1, y2 - y1) * costPerStep;
                if (density[y2] === undefined) continue;
                if (density[y2][x2] === undefined) continue;
                const densityCost = density[y2][x2] * densityWeight;
                cost += stepCost + densityCost;
            }
        }
        return cost;
    }

    private groupSimilarPaths(paths: PathResult[], tolerance: number): PathResult[] {
        if (paths.length === 0) return [];

        const sorted = [...paths].sort((a, b) => a.startY - b.startY);
        const groups: PathResult[][] = [];
        if (sorted[0] === undefined) return [];
        let currentGroup: PathResult[] = [sorted[0]];

        for (let i = 1; i < sorted.length; i++) {
            if (currentGroup[currentGroup.length - 1] === undefined) continue;
            const lastStartY = currentGroup[currentGroup.length - 1]!.startY;
            if (sorted[i] === undefined) continue;
            if (Math.abs(sorted[i]!.startY - lastStartY) <= tolerance) {
                currentGroup.push(sorted[i]!);
            } else {
                groups.push(currentGroup);
                currentGroup = [sorted[i]!];
            }
        }
        groups.push(currentGroup);

        return groups.map(group => group.reduce((best, current) => current.cost < best.cost ? current : best));
    }
}