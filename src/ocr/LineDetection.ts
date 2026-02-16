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

interface PixelPath {
    pixels: [number, number][]; // [col, row]
    cost: number;
    startY: number;
}

export class LineDetection {
    /*
    Schritt 1
    Erstellen einer Bitmap
    */
    public createBitmapFromStrokes(strokes: Stroke[],
        resolution: number,
        horizontalMergeRadius: number = 0
    ): BitmapResult {
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

        let density: number[][] = Array.from({ length: actualHeight }, () => new Array(actualWidth).fill(0));

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
        if (horizontalMergeRadius > 0) {
            density = this.dilateHorizontal(density, horizontalMergeRadius);
        }
        return { density, minX, minY, maxX, maxY };
    }

    /**
 * Wendet einen horizontalen Maximum-Filter auf die Dichtematrix an.
 * @param density - 2D-Array [row][col]
 * @param radius - Anzahl der Pixel links und rechts, die in das Maximum eingehen (insgesamt 2*radius+1)
 * @returns neue Dichtematrix gleicher Größe
 */
    private dilateHorizontal(density: number[][], radius: number): number[][] {
        const height = density.length;
        if (height === 0) return [];
        const width = density[0]?.length ?? 0;
        if (width === 0) return [];

        const result: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let maxVal = 0;
                const startX = Math.max(0, x - radius);
                const endX = Math.min(width - 1, x + radius);
                for (let k = startX; k <= endX; k++) {
                    const val = density[y]?.[k] ?? 0;
                    if (val > maxVal) maxVal = val;
                }
                if (result[y] === undefined) continue;
                result[y]![x] = maxVal;
            }
        }
        return result;
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
        densityWeight: number = 1,
        startRowCandidates?: number[],
        groupTolerance: number = 2
    ): PathResult[] {
        const height = density.length;
        if (height === 0) return [];
        const width = density[0]?.length ?? 0;
        if (width === 0) return [];

        let startCandidates: number[];

        if (startRowCandidates && startRowCandidates.length > 0) {
            // Benutzerdefinierte Kandidaten verwenden, aber auf gültigen Bereich beschneiden
            startCandidates = startRowCandidates
                .map(y => Math.min(Math.max(y, 0), height - 1))
                .filter((v, i, a) => a.indexOf(v) === i); // Duplikate entfernen
        } else {
            // --- Horizontale Projektion (wie gehabt) ---
            const rowSums: number[] = new Array(height).fill(0);
            for (let r = 0; r < height; r++) {
                for (let c = 0; c < width; c++) {
                    if (rowSums[r] === undefined) continue;
                    rowSums[r]! += density[r]?.[c] ?? 0;
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
            const gapCandidates = significantGaps.map(gap => Math.floor((gap.start + gap.end) / 2));

            // --- Zusätzlich: gleichmäßig verteilte Startzeilen ---
            const uniformCandidates: number[] = [];
            const numUniform = 10; // Anzahl gleichmäßig verteilter Zeilen
            for (let i = 0; i < numUniform; i++) {
                const y = Math.floor((i / (numUniform - 1)) * (height - 1));
                uniformCandidates.push(y);
            }

            // Kombinierte Liste (ohne Duplikate)
            startCandidates = [...new Set([...gapCandidates, ...uniformCandidates])].sort((a, b) => a - b);
        }

        const pixelPaths: PixelPath[] = [];

        for (const startY of startCandidates) {
            const path = this.aStarSearch(density, startY, width, height, costPerStep, densityWeight);
            if (path) {
                const cost = this.calculatePathCost(density, path, costPerStep, densityWeight);
                pixelPaths.push({ pixels: path, cost, startY });
            }
        }

        // Gruppieren nach mittlerer y-Koordinate
        const bestPixelPaths = this.groupSimilarPathsByMidY(pixelPaths, width, groupTolerance);

        // In Weltkoordinaten umwandeln
        const paths: PathResult[] = bestPixelPaths.map(p => ({
            points: p.pixels.map(([col, row]) => ({
                x: minX + (col + 0.5) / resolution,
                y: minY + (row + 0.5) / resolution,
                t: 0
            })),
            cost: p.cost,
            startY: p.startY
        }));

        return paths;
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
        const minStepCost = costPerStep; // minimale Kosten pro Schritt (horizontal)

        const openSet: AStarNode[] = [];
        const closedSet = new Set<string>();
        const startNode: AStarNode = {
            x: 0,
            y: startY,
            g: 0,
            h: (width - 1 - 0) * minStepCost,
            f: 0,
            parent: null
        };
        startNode.f = startNode.g + startNode.h;
        openSet.push(startNode);
        const nodeMap = new Map<string, AStarNode>();
        nodeMap.set(`0,${startY}`, startNode);

        let bestTerminalCost = Infinity;
        let bestTerminalNode: AStarNode | null = null;

        while (openSet.length > 0) {
            // Frühzeitiger Abbruch, wenn die beste Lösung bereits besser ist als alle verbleibenden Schätzungen
            if (openSet[0] === undefined) continue;
            if (bestTerminalCost < Infinity && openSet[0].f >= bestTerminalCost) {
                break;
            }

            openSet.sort((a, b) => a.f - b.f);
            const current = openSet.shift()!;
            const key = `${current.x},${current.y}`;
            if (closedSet.has(key)) continue;
            closedSet.add(key);

            // Prüfe, ob current ein terminaler Knoten ist (rechte Kante, obere Kante oder untere Kante)
            const isTerminal = (current.x === width - 1) || (current.y === 0) || (current.y === height - 1);
            if (isTerminal) {
                const totalCost = (current.x === width - 1)
                    ? current.g
                    : current.g + (width - 1 - current.x) * minStepCost;
                if (totalCost < bestTerminalCost) {
                    bestTerminalCost = totalCost;
                    bestTerminalNode = current;
                }
            }

            // Nachbarn expandieren
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = current.x + dx;
                    const ny = current.y + dy;
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                    const neighborKey = `${nx},${ny}`;
                    if (closedSet.has(neighborKey)) continue;

                    const moveCost = Math.hypot(dx, dy) * costPerStep;
                    const densityCost = (density[ny]?.[nx] ?? 0) * densityWeight;
                    const tentativeG = current.g + moveCost + densityCost;

                    let neighbor = nodeMap.get(neighborKey);
                    if (!neighbor) {
                        neighbor = {
                            x: nx,
                            y: ny,
                            g: tentativeG,
                            h: (width - 1 - nx) * minStepCost,
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

        if (bestTerminalNode) {
            const pathToTerminal = this.reconstructPath(bestTerminalNode);
            // Wenn der beste Knoten nicht die rechte Kante erreicht hat, füge horizontale Punkte hinzu
            if (bestTerminalNode.x < width - 1) {
                for (let x = bestTerminalNode.x + 1; x < width; x++) {
                    pathToTerminal.push([x, bestTerminalNode.y]);
                }
            }
            return pathToTerminal;
        }
        return null;
    }

    private reconstructPath(node: AStarNode): [number, number][] {
        const path: [number, number][] = [];
        let current: AStarNode | null = node;
        while (current) {
            path.unshift([current.x, current.y]);
            current = current.parent;
        }
        return path;
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

    private groupSimilarPathsByMidY(
        paths: PixelPath[],
        width: number,
        tolerance: number
    ): PixelPath[] {
        if (paths.length === 0) return [];

        // mittlere y-Koordinate berechnen (bei der Hälfte der x‑Spanne)
        const pathsWithMidY = paths.map(p => {
            const midIndex = Math.floor(p.pixels.length / 2);
            const midY = p.pixels[midIndex]?.[1] ?? p.startY; // Fallback
            return { ...p, midY };
        });

        // nach midY sortieren
        pathsWithMidY.sort((a, b) => a.midY - b.midY);

        // Gruppen bilden (aufsteigend, Differenz zum Vorgänger)
        const groups: PixelPath[][] = [];
        if (pathsWithMidY[0] === undefined) return []; 
        let currentGroup: PixelPath[] = [pathsWithMidY[0]];

        for (let i = 1; i < pathsWithMidY.length; i++) {
            const prev = pathsWithMidY[i - 1];
            const curr = pathsWithMidY[i];
            if (curr && prev)
            if (curr.midY - prev.midY <= tolerance) {
                currentGroup.push(curr);
            } else {
                groups.push(currentGroup);
                currentGroup = [curr];
            }
        }
        groups.push(currentGroup);

        // je Gruppe den Pfad mit minimalen Kosten auswählen
        return groups.map(group =>
            group.reduce((best, curr) => curr.cost < best.cost ? curr : best)
        );
    }
}