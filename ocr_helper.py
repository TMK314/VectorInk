import os
os.environ['FLAGS_use_mkldnn'] = '0'
os.environ['CUDA_VISIBLE_DEVICES'] = ''

import argparse
import json
import sys

def preprocess_for_ocr(image_path):
    """Verdickt dünne Handschrift-Strokes für bessere Detection."""
    import cv2
    import numpy as np

    img = cv2.imread(image_path)
    if img is None:
        return image_path  # Fallback: Originalpfad

    # In Graustufen konvertieren
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Binärisieren: Strokes (dunkel) von Hintergrund (hell) trennen
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)

    # Strokes morphologisch verdicken (Dilatation)
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(binary, kernel, iterations=2)

    # Zurück zu weißem Hintergrund mit schwarzen Strokes
    result = cv2.cvtColor(255 - dilated, cv2.COLOR_GRAY2BGR)

    # Temporäre Datei speichern
    out_path = image_path.replace('.png', '_processed.png')
    cv2.imwrite(out_path, result)
    return out_path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image_path')
    parser.add_argument('--lang', default='en')
    args = parser.parse_args()

    image_path = args.image_path.replace('\\', '/')

    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    # Bild vorverarbeiten
    processed_path = preprocess_for_ocr(image_path)

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
            det_db_unclip_ratio=2.0,
            det_limit_side_len=1280,
            drop_score=0.1,
            use_dilation=True,
        )
    except Exception as e:
        sys.stderr.write(f"[ERROR] Initialisierung fehlgeschlagen: {e}\n")
        sys.stdout = real_stdout
        print(json.dumps([]))
        return

    try:
        raw = ocr.ocr(processed_path, cls=True)
    except Exception as e:
        sys.stderr.write(f"[ERROR] OCR fehlgeschlagen: {e}\n")
        sys.stdout = real_stdout
        print(json.dumps([]))
        return
    finally:
        # Temporäre vorverarbeitete Datei löschen
        if processed_path != image_path:
            try:
                os.remove(processed_path)
            except Exception:
                pass

    sys.stderr.write(f"[DEBUG] raw[0]: {repr(raw[0])[:500]}\n")
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

    print(json.dumps(results))

if __name__ == '__main__':
    main()