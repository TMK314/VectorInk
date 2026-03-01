import os
os.environ['FLAGS_use_mkldnn'] = '0'
os.environ['CUDA_VISIBLE_DEVICES'] = ''

import argparse
import json
import sys

def preprocess(image_path):
    """Leichte Dilatation der Strokes für robustere Detection."""
    import cv2
    import numpy as np
    img = cv2.imread(image_path)
    if img is None:
        return image_path
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    kernel = np.ones((2, 2), np.uint8)
    dilated = cv2.dilate(binary, kernel, iterations=1)
    result = cv2.cvtColor(255 - dilated, cv2.COLOR_GRAY2BGR)
    out_path = image_path.replace('.png', '_pre.png')
    cv2.imwrite(out_path, result)
    return out_path

def merge_nearby_boxes(results):
    """
    Führt OCR-Boxen zusammen, die auf derselben Zeile liegen und nah beieinander sind.
    gap_threshold ist relativ zur medianen Buchstabenhöhe → skalierungsunabhängig.
    """
    if not results:
        return results

    def box_xs(r): return [p[0] for p in r['box']]
    def box_ys(r): return [p[1] for p in r['box']]
    def box_center_y(r): ys = box_ys(r); return sum(ys) / len(ys)
    def box_center_x(r): xs = box_xs(r); return sum(xs) / len(xs)
    def box_height(r): ys = box_ys(r); return max(ys) - min(ys)
    def box_right(r): return max(box_xs(r))
    def box_left(r): return min(box_xs(r))

    # Median-Höhe aller Boxen als Referenz
    heights = sorted([box_height(r) for r in results if box_height(r) > 5])
    median_h = heights[len(heights) // 2] if heights else 50

    # Gleiche-Zeile-Toleranz: 60% der Buchstabenhöhe
    line_tol = median_h * 0.6
    # Wort-Gap-Toleranz: bis zu 1.5× Buchstabenhöhe = Leerzeichen zwischen Wörtern ok
    gap_tol = median_h * 1.5

    results = sorted(results, key=lambda r: (box_center_y(r), box_center_x(r)))
    used = [False] * len(results)
    merged = []

    for i, r in enumerate(results):
        if used[i]:
            continue
        group = [r]
        used[i] = True
        cy_i = box_center_y(r)

        # Iterativ erweitern: nach dem Hinzufügen einer Box die Gruppe neu bewerten
        changed = True
        while changed:
            changed = False
            current_right = max(box_right(g) for g in group)
            current_cy = sum(box_center_y(g) for g in group) / len(group)
            for j, s in enumerate(results):
                if used[j]:
                    continue
                cy_j = box_center_y(s)
                if abs(current_cy - cy_j) > line_tol:
                    continue
                gap = box_left(s) - current_right
                if gap < gap_tol:
                    group.append(s)
                    used[j] = True
                    changed = True

        if len(group) == 1:
            merged.append(r)
        else:
            group.sort(key=box_center_x)
            all_xs = [p[0] for item in group for p in item['box']]
            all_ys = [p[1] for item in group for p in item['box']]
            min_x, max_x = min(all_xs), max(all_xs)
            min_y, max_y = min(all_ys), max(all_ys)
            combined_text = ' '.join(item['text'] for item in group)
            avg_conf = sum(item['confidence'] for item in group) / len(group)
            merged.append({
                'box': [[min_x, min_y], [max_x, min_y], [max_x, max_y], [min_x, max_y]],
                'text': combined_text,
                'confidence': avg_conf
            })

    return merged

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image_path')
    parser.add_argument('--lang', default='en')
    args = parser.parse_args()

    image_path = args.image_path.replace('\\', '/')
    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    processed_path = preprocess(image_path)

    try:
        from paddleocr import PaddleOCR
        ocr = PaddleOCR(
            use_angle_cls=True,
            lang='german',
            use_gpu=False,
            enable_mkldnn=False,
            show_log=False,
            ocr_version='PP-OCRv3',
            det_db_thresh=0.1,
            det_db_box_thresh=0.3,
            det_db_unclip_ratio=3.0,   # Erhöht: verbindet nahe Buchstaben zu Wörtern
            det_limit_side_len=2560,
            drop_score=0.1,
            use_dilation=True,
        )
    except Exception as e:
        sys.stderr.write(f"[ERROR] Initialisierung: {e}\n")
        sys.stdout = real_stdout
        print(json.dumps([]))
        return

    try:
        raw = ocr.ocr(processed_path, cls=True)
    except Exception as e:
        sys.stderr.write(f"[ERROR] OCR: {e}\n")
        sys.stdout = real_stdout
        print(json.dumps([]))
        return
    finally:
        if processed_path != image_path:
            try: os.remove(processed_path)
            except: pass

    sys.stdout = real_stdout

    results = []
    if isinstance(raw, list) and len(raw) > 0:
        page = raw[0]
        if isinstance(page, list):
            for line in page:
                if not isinstance(line, (list, tuple)) or len(line) < 2:
                    continue
                box_raw, text_info = line[0], line[1]
                if not isinstance(box_raw, (list, tuple)) or len(box_raw) < 2:
                    continue
                box = [[float(p[0]), float(p[1])] for p in box_raw]
                if isinstance(text_info, (list, tuple)) and len(text_info) >= 2:
                    text, confidence = str(text_info[0]), float(text_info[1])
                elif isinstance(text_info, str):
                    text, confidence = text_info, 1.0
                else:
                    continue
                results.append({"box": box, "text": text, "confidence": confidence})

    # Nahe Boxen auf gleicher Zeile zusammenführen
    results = merge_nearby_boxes(results)

    print(json.dumps(results))

if __name__ == '__main__':
    main()