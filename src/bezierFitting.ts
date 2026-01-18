import { Point } from './types';

export interface CubicBezier {
    p0: Point;  // Startpunkt
    p1: Point;  // Erster Kontrollpunkt
    p2: Point;  // Zweiter Kontrollpunkt
    p3: Point;  // Endpunkt
}

export interface CurveSegment {
    points: Point[];
    bezier?: CubicBezier;
    error?: number;
}

export interface CurveFittingOptions {
    epsilon: number;              // Maximaler Fehler für Segmentakzeptanz
    minSegmentLength: number;     // Minimale Segmentlänge in Pixeln
    maxIterations: number;        // Maximale Iterationen für Rekursion
    curvatureThreshold: number;   // Schwellenwert für Krümmungsänderung
    usePressure: boolean;         // Druckinformationen verwenden
}

export class BezierCurveFitter {
    private options: CurveFittingOptions;

    constructor(options: Partial<CurveFittingOptions> = {}) {
        this.options = {
            epsilon: options.epsilon || 2.0,
            minSegmentLength: options.minSegmentLength || 40,  // Erhöht von 20 auf 40
            maxIterations: options.maxIterations || 5,         // Reduziert von 10 auf 5
            curvatureThreshold: options.curvatureThreshold || 0.2,  // Erhöht von 0.1 auf 0.2
            usePressure: options.usePressure || false
        };
    }

    /**
     * Hauptfunktion: Wandelt Punkte in Bézierkurven um
     */
    public fitCurve(points: Point[]): CubicBezier[] {
        if (points.length < 4) {
            // Zu wenige Punkte für kubische Bézier
            return [this.fitLineToBezier(points)];
        }

        // 1. Vorverarbeitung: Parametrisierung & Rauschentkopplung
        const processedPoints = this.preprocessPoints(points);

        // 2. Kurvensegmentierung anhand von Geometrie
        const segments = this.segmentByGeometry(processedPoints);
        console.log(`Segments: ${segments.length} from ${points.length} points`);

        // 3. Bézier-Fit auf jedem Segment
        const bezierSegments: CurveSegment[] = [];

        for (const segment of segments) {
            const fitted = this.fitSegment(segment);
            bezierSegments.push(...fitted);
        }

        console.log(`Bezier segments before merging: ${bezierSegments.length}`);

        // 5. Explizite Kurvenreduktion (Segmentfusion)
        const mergedSegments = this.mergeSegments(bezierSegments);

        console.log(`Final bezier curves: ${mergedSegments.length}`);

        return mergedSegments.map(s => s.bezier!);
    }

    /**
     * 1. Vorverarbeitung: Parametrisierung & Rauschentkopplung
     */
    private preprocessPoints(points: Point[]): Point[] {
        if (points.length < 3) {
            return points;
        }

        // Einfacherer Filter - weniger aggressiv
        const filtered: Point[] = [points[0]!];
        const n = points.length;

        for (let i = 1; i < n - 1; i++) {
            const p0 = points[i - 1];
            const p1 = points[i];
            const p2 = points[i + 1];

            if (p0 && p1 && p2) {
                // Sehr leichter Filter - behält mehr Originalform bei
                filtered.push({
                    x: (p0.x + 2 * p1.x + p2.x) / 4,
                    y: (p0.y + 2 * p1.y + p2.y) / 4,
                    t: p1.t,
                    pressure: p1.pressure || 0.5
                });
            } else if (p1) {
                filtered.push(p1);
            }
        }

        if (points[n - 1]) {
            filtered.push(points[n - 1]!);
        }

        return filtered;
    }

    /**
     * 2. Kurvensegmentierung anhand von Geometrie - WENIGER AGGRESSIV
     */
    private segmentByGeometry(points: Point[]): Point[][] {
        if (points.length < 4) {
            return [points];
        }

        const segments: Point[][] = [];
        let currentSegment: Point[] = [points[0]!];

        // Berechne Krümmung für jeden Punkt
        const curvatures = this.computeCurvatures(points);
        const segmentLengthThreshold = this.options.minSegmentLength * 5; // Höherer Schwellenwert

        for (let i = 1; i < points.length - 1; i++) {
            const curr = points[i];
            if (!curr) continue;

            currentSegment.push(curr);

            // Weniger aggressive Segmentierungsregeln
            const shouldSplit =
                // Nur bei starken Wendepunkten (Vorzeichenwechsel UND hohe Krümmung)
                (i > 1 && curvatures[i - 1]! * curvatures[i]! < 0 &&
                    Math.abs(curvatures[i]!) > this.options.curvatureThreshold * 2) ||
                // Sehr hohe Krümmungsänderung
                (i > 1 && Math.abs(curvatures[i]! - curvatures[i - 1]!) > this.options.curvatureThreshold * 3) ||
                // Sehr lange Segmente
                (this.segmentLength(currentSegment) > segmentLengthThreshold);

            if (shouldSplit && currentSegment.length >= 6) { // Mindestens 6 Punkte pro Segment
                segments.push([...currentSegment]);
                currentSegment = [curr]; // Starte neues Segment mit aktuellem Punkt
            }
        }

        // Letztes Segment hinzufügen
        const last = points[points.length - 1];
        if (last) {
            currentSegment.push(last);
        }
        if (currentSegment.length >= 3) {
            segments.push(currentSegment);
        }

        return segments;
    }

    /**
     * Berechnet Krümmung für jeden Punkt
     */
    private computeCurvatures(points: Point[]): number[] {
        const curvatures: number[] = new Array(points.length).fill(0);

        for (let i = 1; i < points.length - 1; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const next = points[i + 1];

            if (!prev || !curr || !next) continue;

            // Differenzen
            const dx1 = curr.x - prev.x;
            const dy1 = curr.y - prev.y;
            const dx2 = next.x - curr.x;
            const dy2 = next.y - curr.y;

            // Krümmung berechnen
            const cross = dx1 * dy2 - dy1 * dx2;
            const dot = dx1 * dx2 + dy1 * dy2;
            const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
            const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

            if (len1 * len2 > 0) {
                curvatures[i] = cross / (len1 * len2);
            }
        }

        // Glättung
        const smoothed: number[] = [...curvatures];
        for (let i = 1; i < curvatures.length - 1; i++) {
            smoothed[i] = (curvatures[i - 1]! + curvatures[i]! + curvatures[i + 1]!) / 3;
        }

        return smoothed;
    }

    /**
     * 3. Direkter Bézier-Fit auf Segment
     */
    private fitSegment(segmentPoints: Point[]): CurveSegment[] {
        if (segmentPoints.length < 4) {
            // Für zu kurze Segmente einfache Linie
            const bezier = this.fitLineToBezier(segmentPoints);
            return [{
                points: segmentPoints,
                bezier: bezier,
                error: 0
            }];
        }

        // Weniger aggressive Rekursion
        return this.fitCubicRecursive(segmentPoints, 0, segmentPoints.length - 1);
    }

    /**
     * Rekursiver kubischer Bézier-Fit mit Fehlerkontrolle
     */
    private fitCubicRecursive(
        points: Point[],
        first: number,
        last: number,
        iteration: number = 0
    ): CurveSegment[] {
        if (iteration >= this.options.maxIterations || last - first < 4) {
            return [this.createSegmentFromPoints(points.slice(first, last + 1))];
        }

        // Versuche gesamtes Segment zu fitten
        const bezier = this.fitCubicBezier(points, first, last);
        const { maxError, splitIndex } = this.computeMaxError(points, first, last, bezier);

        // Akzeptanzkriterium - mit erhöhtem Epsilon für weniger Segmente
        if (maxError <= this.options.epsilon * 1.5) {
            return [{
                points: points.slice(first, last + 1),
                bezier: bezier,
                error: maxError
            }];
        }

        // Nur teilen, wenn der Fehler signifikant ist UND wir noch nicht zu viele Iterationen hatten
        if (splitIndex === -1 || splitIndex <= first || splitIndex >= last || last - first < 8) {
            // Zu kurz zum Teilen
            return [this.createSegmentFromPoints(points.slice(first, last + 1))];
        }

        // Teile am Punkt mit maximalem Fehler
        const left = this.fitCubicRecursive(points, first, splitIndex, iteration + 1);
        const right = this.fitCubicRecursive(points, splitIndex, last, iteration + 1);

        return [...left, ...right];
    }

    /**
     * Kubische Bézierkurve an Punkte anpassen (Least-Squares)
     */
    private fitCubicBezier(
        points: Point[],
        first: number,
        last: number
    ): CubicBezier {
        const p0 = points[first];
        const p3 = points[last];
        if (!p0 || !p3) {
            throw new Error('Invalid segment');
        }

        const tHat = this.chordLengthParameterize(points, first, last);
        const tanStart = this.computeTangent(points, first, true);
        const tanEnd = this.computeTangent(points, last, false);

        let C00 = 0, C01 = 0, C11 = 0;
        let X0 = 0, X1 = 0;

        for (let i = 1; i < tHat.length - 1; i++) {
            const t = tHat[i]!;
            const u = 1 - t;

            const b0 = u * u * u;
            const b1 = 3 * u * u * t;
            const b2 = 3 * u * t * t;
            const b3 = t * t * t;

            const a1 = b1;
            const a2 = b2;

            C00 += a1 * a1;
            C01 += a1 * a2;
            C11 += a2 * a2;

            const px = points[first + i]!.x -
                (b0 * p0.x + b3 * p3.x);
            const py = points[first + i]!.y -
                (b0 * p0.y + b3 * p3.y);

            X0 += a1 * (px * tanStart.x + py * tanStart.y);
            X1 += a2 * (px * tanEnd.x + py * tanEnd.y);
        }

        const det = C00 * C11 - C01 * C01;
        let alpha = 0, beta = 0;

        if (Math.abs(det) > 1e-6) {
            alpha = (X0 * C11 - X1 * C01) / det;
            beta = (C00 * X1 - C01 * X0) / det;
        } else {
            const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3;
            alpha = beta = dist;
        }

        // Fallback bei degenerierten Lösungen
        const minDist = 1e-3 * Math.hypot(p3.x - p0.x, p3.y - p0.y);
        if (alpha < minDist || beta < minDist) {
            const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3;
            alpha = beta = dist;
        }

        return {
            p0,
            p1: {
                x: p0.x + tanStart.x * alpha,
                y: p0.y + tanStart.y * alpha,
                t: p0.t,
                pressure: p0.pressure
            },
            p2: {
                x: p3.x + tanEnd.x * beta,
                y: p3.y + tanEnd.y * beta,
                t: p3.t,
                pressure: p3.pressure
            },
            p3
        };
    }

    private chordLengthParameterize(
        points: Point[],
        first: number,
        last: number
    ): number[] {
        const u: number[] = [0];
        let total = 0;

        for (let i = first; i < last; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            if (!p0 || !p1) continue;

            const dx = p1.x - p0.x;
            const dy = p1.y - p0.y;
            total += Math.sqrt(dx * dx + dy * dy);
            u.push(total);
        }

        if (total === 0) {
            return u.map(() => 0);
        }

        // Normalisieren auf [0,1]
        return u.map(v => v / total);
    }


    /**
     * Berechnet Tangente an einem Punkt
     */
    private computeTangent(
        points: Point[],
        index: number,
        isStart: boolean
    ): { x: number; y: number } {

        const step = isStart ? 1 : -1;
        const limit = isStart
            ? Math.min(index + 4, points.length - 1)
            : Math.max(index - 4, 0);

        let dx = 0, dy = 0, count = 0;

        for (
            let i = index;
            isStart ? i < limit : i > limit;
            i += step
        ) {
            const p0 = points[i];
            const p1 = points[i + step];
            if (!p0 || !p1) continue;

            dx += p1.x - p0.x;
            dy += p1.y - p0.y;
            count++;
        }

        if (count === 0) {
            return isStart ? { x: 1, y: 0 } : { x: -1, y: 0 };
        }

        const len = Math.hypot(dx, dy);
        return len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
    }

    /**
     * Berechnet maximalen orthogonalen Abstand zur Bézierkurve
     */
    private computeMaxError(
        points: Point[],
        first: number,
        last: number,
        bezier: CubicBezier
    ): { maxError: number; splitIndex: number } {

        const tHat = this.chordLengthParameterize(points, first, last);
        let maxError = 0;
        let splitIndex = Math.floor((first + last) / 2);

        for (let i = 1; i < tHat.length - 1; i++) {
            const t = tHat[i]!;
            const curvePoint = this.evaluateBezier(bezier, t);
            const p = points[first + i]!;

            const dx = p.x - curvePoint.x;
            const dy = p.y - curvePoint.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > maxError) {
                maxError = dist;
                splitIndex = first + i;
            }
        }

        return { maxError, splitIndex };
    }

    /**
     * Wertet Bézierkurve an Position t aus (0 ≤ t ≤ 1)
     */
    public evaluateBezier(bezier: CubicBezier, t: number): Point {
        const u = 1 - t;
        const t2 = t * t;
        const u2 = u * u;
        const u3 = u2 * u;
        const t3 = t2 * t;

        const x = u3 * bezier.p0.x +
            3 * u2 * t * bezier.p1.x +
            3 * u * t2 * bezier.p2.x +
            t3 * bezier.p3.x;

        const y = u3 * bezier.p0.y +
            3 * u2 * t * bezier.p1.y +
            3 * u * t2 * bezier.p2.y +
            t3 * bezier.p3.y;

        // Lineare Interpolation
        const pressure = (bezier.p0.pressure || 0.5) * (1 - t) + (bezier.p3.pressure || 0.5) * t;

        return {
            x,
            y,
            t: bezier.p0.t + (bezier.p3.t - bezier.p0.t) * t,
            pressure
        };
    }

    /**
     * 5. Segmentfusion - WENIGER AGGRESSIV
     */
    private mergeSegments(segments: CurveSegment[]): CurveSegment[] {
        if (segments.length <= 1) {
            return segments;
        }

        const merged: CurveSegment[] = [segments[0]!];

        for (let i = 1; i < segments.length; i++) {
            const prev = merged[merged.length - 1];
            const curr = segments[i];

            if (!prev || !curr) {
                continue;
            }

            if (!prev.bezier || !curr.bezier) {
                merged.push(curr);
                continue;
            }

            // Prüfe ob die Segmente klein genug sind um zusammengeführt zu werden
            const prevLength = this.segmentLength(prev.points);
            const currLength = this.segmentLength(curr.points);

            // Nur kleine Segmente zusammenführen
            if (prevLength < 30 && currLength < 30) {
                const combinedPoints = [...prev.points, ...curr.points];
                try {
                    const combinedBezier = this.fitCubicBezier(combinedPoints, 0, combinedPoints.length - 1);
                    const { maxError: combinedError } = this.computeMaxError(
                        combinedPoints, 0, combinedPoints.length - 1, combinedBezier
                    );

                    if (combinedError <= this.options.epsilon * 2) {
                        // Segmente zusammenführen
                        prev.points = combinedPoints;
                        prev.bezier = combinedBezier;
                        prev.error = combinedError;
                        continue;
                    }
                } catch (error) {
                    // Fehler beim Zusammenführen - separat behalten
                }
            }

            merged.push(curr);
        }

        return merged;
    }

    /**
     * Hilfsfunktionen
     */
    private segmentLength(points: Point[]): number {
        let length = 0;
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];

            if (!prev || !curr) continue;

            const dx = curr.x - prev.x;
            const dy = curr.y - prev.y;
            length += Math.sqrt(dx * dx + dy * dy);
        }
        return length;
    }

    private fitLineToBezier(points: Point[]): CubicBezier {
        if (points.length === 0) {
            return {
                p0: { x: 0, y: 0, t: 0, pressure: 0.5 },
                p1: { x: 0, y: 0, t: 0, pressure: 0.5 },
                p2: { x: 0, y: 0, t: 0, pressure: 0.5 },
                p3: { x: 0, y: 0, t: 0, pressure: 0.5 }
            };
        }

        const p0 = points[0]!;
        const p3 = points[points.length - 1]!;

        // Für eine Linie: Kontrollpunkte auf 1/3 und 2/3 der Strecke
        const dx = p3.x - p0.x;
        const dy = p3.y - p0.y;

        return {
            p0: p0,
            p1: {
                x: p0.x + dx / 3,
                y: p0.y + dy / 3,
                t: p0.t,
                pressure: p0.pressure || 0.5
            },
            p2: {
                x: p0.x + 2 * dx / 3,
                y: p0.y + 2 * dy / 3,
                t: p3.t,
                pressure: p3.pressure || 0.5
            },
            p3: p3
        };
    }

    private createSegmentFromPoints(points: Point[]): CurveSegment {
        try {
            const bezier = this.fitCubicBezier(points, 0, points.length - 1);
            const { maxError } = this.computeMaxError(points, 0, points.length - 1, bezier);

            return {
                points: points,
                bezier: bezier,
                error: maxError
            };
        } catch (error) {
            const bezier = this.fitLineToBezier(points);
            return {
                points: points,
                bezier: bezier,
                error: 0
            };
        }
    }

    /**
     * Wandelt Bézierkurven zurück in Punkte (für Rendering)
     */
    public bezierToPoints(bezier: CubicBezier, numPoints: number = 10): Point[] { // Reduziert von 20 auf 10
        const points: Point[] = [];

        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            points.push(this.evaluateBezier(bezier, t));
        }

        return points;
    }

    /**
     * Optimiert die Epsilon-Einstellung basierend auf der Kurvenkomplexität
     */
    public autoAdjustEpsilon(points: Point[]): number {
        if (points.length < 10) {
            return this.options.epsilon;
        }

        // Einfache Heuristik: Je mehr Punkte, desto höheres Epsilon für weniger Details
        const pointCountFactor = Math.min(3, points.length / 50);
        return this.options.epsilon * pointCountFactor;
    }
}