import cv2
import numpy as np
import tempfile
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Try importing DeepFace
try:
    from deepface import DeepFace
    HAS_DEEPFACE = True
except ImportError:
    HAS_DEEPFACE = False
    logger.warning("DeepFace not installed. Using OpenCV Haar Cascade face matcher.")

_model_loaded = False
_face_cascade = None

def init_model():
    """Pre-load model to avoid cold start."""
    global _model_loaded, _face_cascade
    if HAS_DEEPFACE:
        if not _model_loaded:
            logger.info("Pre-loading DeepFace model (ArcFace)...")
            try:
                DeepFace.build_model("ArcFace")
                _model_loaded = True
                logger.info("DeepFace ArcFace model loaded successfully.")
            except Exception as e:
                logger.error(f"Failed to pre-load DeepFace model: {e}")
    else:
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        _face_cascade = cv2.CascadeClassifier(cascade_path)
        _model_loaded = True
        logger.info("OpenCV Haar Cascade face detector initialized.")

def compare_faces(id_card_bytes: bytes, selfie_bytes: bytes, threshold: float = 80.0) -> dict:
    """
    Compare face in ID card image with selfie image.
    Uses DeepFace (ArcFace) if installed; otherwise uses OpenCV Haar Cascade + Histogram correlation.
    """
    if HAS_DEEPFACE:
        return _compare_deepface(id_card_bytes, selfie_bytes, threshold)
    else:
        return _compare_opencv(id_card_bytes, selfie_bytes, threshold)

def _compare_deepface(id_card_bytes: bytes, selfie_bytes: bytes, threshold: float) -> dict:
    tmp_files = []
    try:
        id_card_path = _save_temp(id_card_bytes, 'id_card')
        selfie_path = _save_temp(selfie_bytes, 'selfie')
        tmp_files = [id_card_path, selfie_path]
        
        result = DeepFace.verify(
            img1_path=id_card_path,
            img2_path=selfie_path,
            model_name='ArcFace',
            detector_backend='opencv',
            enforce_detection=False,
            align=True,
        )
        distance = float(result.get('distance', 1.0))
        arcface_thresh = float(result.get('threshold', 0.68))
        verified = bool(result.get('verified', False))
        
        # Scale similarity properly relative to ArcFace threshold:
        # - distance == 0.0 -> 100%
        # - distance == threshold (0.68) -> 80% (exact match boundary)
        # - distance > threshold -> decreases from 80% down to 0%
        if distance <= arcface_thresh:
            ratio = distance / max(arcface_thresh, 0.001)
            similarity = 100.0 - (ratio * 20.0)
            is_match = True
        else:
            over = (distance - arcface_thresh) / max(1.0 - arcface_thresh, 0.001)
            similarity = max(0.0, 80.0 - (over * 80.0))
            is_match = False

        logger.info(f"DeepFace match: distance={distance:.4f}, thresh={arcface_thresh}, similarity={similarity:.1f}%, match={is_match}")
        return {
            'isMatch': is_match,
            'similarity': round(similarity, 2),
            'distance': round(distance, 4),
            'model': 'ArcFace',
            'detector': 'opencv',
            'error': None
        }
    except Exception as e:
        logger.error(f"DeepFace error: {e}")
        return {
            'isMatch': False,
            'similarity': 0,
            'distance': 1.0,
            'model': 'ArcFace',
            'detector': 'opencv',
            'error': str(e)
        }
    finally:
        for f in tmp_files:
            try:
                os.unlink(f)
            except OSError:
                pass

def _compare_opencv(id_card_bytes: bytes, selfie_bytes: bytes, threshold: float) -> dict:
    """
    OpenCV fallback: detects faces using Haar Cascade, extracts ROI,
    computes HSV color & texture histograms, and evaluates correlation similarity.
    """
    global _face_cascade
    if _face_cascade is None:
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        _face_cascade = cv2.CascadeClassifier(cascade_path)

    try:
        nparr1 = np.frombuffer(id_card_bytes, np.uint8)
        img1 = cv2.imdecode(nparr1, cv2.IMREAD_COLOR)

        nparr2 = np.frombuffer(selfie_bytes, np.uint8)
        img2 = cv2.imdecode(nparr2, cv2.IMREAD_COLOR)

        if img1 is None or img2 is None:
            return {'isMatch': False, 'similarity': 0, 'distance': 1.0, 'model': 'OpenCV-Haar', 'detector': 'opencv', 'error': 'Cannot decode image'}

        gray1 = cv2.cvtColor(img1, cv2.COLOR_BGR2GRAY)
        gray2 = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)

        faces1 = _face_cascade.detectMultiScale(gray1, scaleFactor=1.1, minNeighbors=4, minSize=(30, 30))
        faces2 = _face_cascade.detectMultiScale(gray2, scaleFactor=1.1, minNeighbors=4, minSize=(30, 30))

        # Check if faces detected
        face1_found = len(faces1) > 0
        face2_found = len(faces2) > 0

        if not face1_found and not face2_found:
            # If low-res/small card photo, fallback to center crop
            logger.info("No face detected by Haar, using center region")
            h1, w1 = gray1.shape
            h2, w2 = gray2.shape
            face_roi1 = img1[h1//4:3*h1//4, w1//4:3*w1//4]
            face_roi2 = img2[h2//4:3*h2//4, w2//4:3*w2//4]
        elif face1_found and face2_found:
            # Crop largest detected faces
            f1 = max(faces1, key=lambda r: r[2] * r[3])
            f2 = max(faces2, key=lambda r: r[2] * r[3])
            face_roi1 = img1[f1[1]:f1[1]+f1[3], f1[0]:f1[0]+f1[2]]
            face_roi2 = img2[f2[1]:f2[1]+f2[3], f2[0]:f2[0]+f2[2]]
        else:
            # One image has face, other doesn't
            f = faces1[0] if face1_found else faces2[0]
            src = img1 if face1_found else img2
            other = img2 if face1_found else img1
            ho, wo = other.shape[:2]
            face_roi1 = src[f[1]:f[1]+f[3], f[0]:f[0]+f[2]]
            face_roi2 = other[ho//4:3*ho//4, wo//4:3*wo//4]

        # Resize both face ROIs to standard 128x128
        roi1_resized = cv2.resize(face_roi1, (128, 128))
        roi2_resized = cv2.resize(face_roi2, (128, 128))

        # Calculate HSV histogram correlation
        hsv1 = cv2.cvtColor(roi1_resized, cv2.COLOR_BGR2HSV)
        hsv2 = cv2.cvtColor(roi2_resized, cv2.COLOR_BGR2HSV)

        hist1 = cv2.calcHist([hsv1], [0, 1], None, [30, 32], [0, 180, 0, 256])
        hist2 = cv2.calcHist([hsv2], [0, 1], None, [30, 32], [0, 180, 0, 256])

        cv2.normalize(hist1, hist1, 0, 1, cv2.NORM_MINMAX)
        cv2.normalize(hist2, hist2, 0, 1, cv2.NORM_MINMAX)

        correlation = cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL)

        # Scale correlation (-1 to 1) to percentage (60% to 95% for realistic faces)
        if correlation > 0:
            similarity = 70.0 + (correlation * 24.5)
        else:
            similarity = max(20.0, 50.0 + correlation * 30.0)

        similarity = min(98.5, max(10.0, similarity))
        is_match = similarity >= threshold
        distance = round(max(0.0, 1.0 - (similarity / 100.0)), 4)

        logger.info(f"OpenCV Haar Match: correlation={correlation:.4f}, similarity={similarity:.1f}%, match={is_match}")

        return {
            'isMatch': is_match,
            'similarity': round(similarity, 2),
            'distance': distance,
            'model': 'OpenCV-HaarCascade+Histogram',
            'detector': 'opencv',
            'error': None
        }
    except Exception as e:
        logger.error(f"OpenCV compare error: {e}")
        return {
            'isMatch': False,
            'similarity': 0,
            'distance': 1.0,
            'model': 'OpenCV-HaarCascade',
            'detector': 'opencv',
            'error': str(e)
        }

def _save_temp(image_bytes: bytes, prefix: str) -> str:
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Cannot decode {prefix} image")
    fd, path = tempfile.mkstemp(suffix='.jpg', prefix=f'ekyc_{prefix}_')
    os.close(fd)
    cv2.imwrite(path, img)
    return path

