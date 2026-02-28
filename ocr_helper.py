import os
os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'

import argparse
import json
import sys
from paddleocr import PaddleOCR

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image_path')
    parser.add_argument('--lang', default='en')
    args = parser.parse_args()

    # OCR initialisieren – verschiedene Parameter ausprobieren
    ocr = None
    param_sets = [
        {'show_log': False, 'use_angle_cls': True, 'lang': args.lang},
        {'use_angle_cls': True, 'lang': args.lang},
        {'lang': args.lang},
        {'use_textline_orientation': True, 'lang': args.lang},
    ]

    for params in param_sets:
        try:
            ocr = PaddleOCR(**params)
            break
        except (TypeError, ValueError):
            continue

    if ocr is None:
        print(json.dumps([]))
        return

    # OCR auf Bild anwenden – verschiedene Aufrufmethoden
    result = None
    try:
        # Versuch 1: Alte Methode mit cls
        result = ocr.ocr(args.image_path, cls=True)
    except Exception:
        try:
            # Versuch 2: Alte Methode ohne cls
            result = ocr.ocr(args.image_path)
        except Exception:
            try:
                # Versuch 3: Neue Methode predict()
                result = ocr.predict(args.image_path)
            except Exception:
                print(json.dumps([]))
                return

    # Ergebnis parsen
    try:
        texts = []
        if isinstance(result, list) and len(result) > 0:
            # Das erste Element enthält die erkannten Blöcke
            blocks = result[0] if isinstance(result[0], list) else result
            for block in blocks:
                if isinstance(block, list) and len(block) > 1:
                    # block = [ Koordinaten, (Text, Konfidenz) ]
                    if isinstance(block[1], (list, tuple)) and len(block[1]) > 0:
                        texts.append(block[1][0])
                    elif isinstance(block[1], str):
                        texts.append(block[1])
        print(json.dumps(texts))
    except Exception:
        print(json.dumps([]))

if __name__ == '__main__':
    main()