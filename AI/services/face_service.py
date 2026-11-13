import cv2
import numpy as np
import tempfile
import os
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Ngưỡng cosine distance cho ArcFace trong eKYC (chặt hơn mức mặc định 0.68 của DeepFace
# để tránh nhận nhầm ảnh người lạ / ảnh mạng có khuôn mặt tương tự).
ARCFACE_STRICT_COSINE_THRESHOLD = float(os.getenv("ARCFACE_COSINE_THRESHOLD", "0.52"))

# Try importing DeepFace
try:
    from deepface import DeepFace
    HAS_DEEPFACE = True
except ImportError:
    HAS_DEEPFACE = False
    logger.warning("DeepFace not installed. Face matching requires DeepFace (run via AI/.venv).")

_model_loaded = False

def init_model():
    """Pre-load DeepFace models (ArcFace + MTCNN detector) to avoid cold start."""
    global _model_loaded
    if HAS_DEEPFACE:
        if not _model_loaded:
            logger.info("Pre-loading DeepFace models (ArcFace + MTCNN)...")
            try:
                DeepFace.build_model("ArcFace")
                try:
                    DeepFace.build_model("mtcnn", task="face_detector")
                except Exception as det_err:
                    logger.warning(f"Optional MTCNN pre-load skipped: {det_err}")
                _model_loaded = True
                logger.info("DeepFace ArcFace model loaded successfully.")
            except Exception as e:
                logger.error(f"Failed to pre-load DeepFace model: {e}")
    else:
        logger.error("DeepFace is NOT installed in this Python interpreter. Please run with AI/.venv!")

def compare_faces(id_card_bytes: bytes, selfie_bytes: bytes, threshold: float = 80.0) -> dict:
    """
    Compare face in ID card image with selfie image.
    Uses DeepFace (ArcFace) with strict face detection (no full-image fallback).
    """
    if HAS_DEEPFACE:
        return _compare_deepface(id_card_bytes, selfie_bytes, threshold)
    else:
        return _compare_unavailable()


def _detect_primary_face_crop(img_bgr: np.ndarray, label: str) -> Tuple[Optional[np.ndarray], str, Optional[str]]:
    """
    Detect faces strictly using MTCNN first, then OpenCV Haar Cascade.
    Returns (cropped_bgr_with_margin, detector_used, error_message).
    Never falls back to comparing raw uncropped images without a detected face.
    """
    h, w = img_bgr.shape[:2]
    detectors = ["mtcnn", "opencv"]

    for det in detectors:
        try:
            faces = DeepFace.extract_faces(
                img_path=img_bgr,
                detector_backend=det,
                enforce_detection=True,
                align=False,
                grayscale=False,
                normalize_face=False,
            )
            if not faces:
                continue

            # Lọc bỏ các box nhiễu quá nhỏ (< 28px)
            valid_faces = [
                f for f in faces
                if f.get("facial_area", {}).get("w", 0) >= 28
                and f.get("facial_area", {}).get("h", 0) >= 28
            ]
            if not valid_faces:
                continue

            # Chọn khuôn mặt có (confidence * diện tích) lớn nhất để tránh ghép nhầm ảnh nền / watermark
            best = max(
                valid_faces,
                key=lambda f: max(float(f.get("confidence") or 0.5), 0.1)
                * float(f["facial_area"]["w"] * f["facial_area"]["h"]),
            )
            area = best["facial_area"]
            fx, fy, fw, fh = int(area["x"]), int(area["y"]), int(area["w"]), int(area["h"])

            # Mở rộng vùng biên 35% để DeepFace.verify thực hiện alignment mắt/mũi/miệng chính xác
            pad_x = int(fw * 0.35)
            pad_y = int(fh * 0.35)
            x1 = max(0, fx - pad_x)
            y1 = max(0, fy - pad_y)
            x2 = min(w, fx + fw + pad_x)
            y2 = min(h, fy + fh + pad_y)

            crop = img_bgr[y1:y2, x1:x2]
            if crop.size == 0:
                continue

            logger.info(
                f"Detected face in {label} using {det}: box=({fx},{fy},{fw},{fh}), conf={best.get('confidence')}"
            )
            return crop, det, None
        except ValueError:
            continue
        except Exception as e:
            logger.warning(f"Face detector {det} failed on {label}: {e}")
            continue

    return (
        None,
        "none",
        f"Không phát hiện được khuôn mặt rõ nét trong ảnh {label}. Vui lòng chụp lại rõ mặt và đủ ánh sáng.",
    )


def _compare_deepface(id_card_bytes: bytes, selfie_bytes: bytes, threshold: float) -> dict:
    tmp_files = []
    try:
        id_img = _decode_image(id_card_bytes, "CCCD")
        selfie_img = _decode_image(selfie_bytes, "selfie")

        # 1. Bắt buộc phát hiện được khuôn mặt rõ ràng trong CẢ 2 ảnh
        id_crop, id_det, id_err = _detect_primary_face_crop(id_img, "CCCD")
        if id_crop is None:
            return {
                "isMatch": False,
                "similarity": 0,
                "distance": 1.0,
                "model": "ArcFace",
                "detector": id_det,
                "error": id_err,
            }

        selfie_crop, selfie_det, selfie_err = _detect_primary_face_crop(selfie_img, "selfie")
        if selfie_crop is None:
            return {
                "isMatch": False,
                "similarity": 0,
                "distance": 1.0,
                "model": "ArcFace",
                "detector": selfie_det,
                "error": selfie_err,
            }

        id_card_path = _save_cv_temp(id_crop, "id_card")
        selfie_path = _save_cv_temp(selfie_crop, "selfie")
        tmp_files = [id_card_path, selfie_path]

        # 2. Chạy ArcFace verify trên 2 vùng khuôn mặt đã cắt chuẩn với enforce_detection=True
        detector_used = selfie_det if selfie_det == id_det else "mtcnn"
        try:
            result = DeepFace.verify(
                img1_path=id_card_path,
                img2_path=selfie_path,
                model_name="ArcFace",
                detector_backend=detector_used,
                distance_metric="cosine",
                enforce_detection=True,
                align=True,
                threshold=ARCFACE_STRICT_COSINE_THRESHOLD,
            )
        except ValueError:
            # Nếu crop lại khiến detector thứ cấp trượt nhẹ ở biên, fallback về mtcnn hoặc skip alignment trên crop đã detect
            result = DeepFace.verify(
                img1_path=id_card_path,
                img2_path=selfie_path,
                model_name="ArcFace",
                detector_backend="opencv",
                distance_metric="cosine",
                enforce_detection=True,
                align=True,
                threshold=ARCFACE_STRICT_COSINE_THRESHOLD,
            )
            detector_used = "opencv"

        distance = float(result.get("distance", 1.0))
        arcface_thresh = ARCFACE_STRICT_COSINE_THRESHOLD

        # Quy đổi khoảng cách cosine ArcFace sang % tương đồng:
        # - distance == 0.0 -> 100%
        # - distance == arcface_thresh (0.52) -> 80% (ngưỡng tối thiểu đạt khớp)
        # - distance > arcface_thresh -> giảm nhanh từ 80% về 0%
        if distance <= arcface_thresh:
            ratio = distance / max(arcface_thresh, 0.001)
            similarity = 100.0 - (ratio * 20.0)
        else:
            over = (distance - arcface_thresh) / max(1.0 - arcface_thresh, 0.001)
            similarity = max(0.0, 80.0 - (over * 80.0))

        similarity = round(similarity, 2)
        is_match = (distance <= arcface_thresh) and (similarity >= threshold)

        logger.info(
            f"DeepFace match: distance={distance:.4f}, strict_thresh={arcface_thresh}, "
            f"similarity={similarity:.1f}%, match={is_match}, detector={detector_used}"
        )
        return {
            "isMatch": is_match,
            "similarity": similarity,
            "distance": round(distance, 4),
            "model": "ArcFace",
            "detector": detector_used,
            "error": None,
        }
    except ValueError as e:
        logger.warning(f"DeepFace detection error: {e}")
        return {
            "isMatch": False,
            "similarity": 0,
            "distance": 1.0,
            "model": "ArcFace",
            "detector": "mtcnn",
            "error": "Không phát hiện được khuôn mặt rõ nét để đối chiếu. Vui lòng chụp lại rõ mặt.",
        }
    except Exception as e:
        logger.error(f"DeepFace error: {e}")
        return {
            "isMatch": False,
            "similarity": 0,
            "distance": 1.0,
            "model": "ArcFace",
            "detector": "mtcnn",
            "error": str(e),
        }
    finally:
        for f in tmp_files:
            try:
                os.unlink(f)
            except OSError:
                pass

def _compare_unavailable() -> dict:
    """Reject face matching if DeepFace is not installed (never fake match with color histograms)."""
    logger.error("DeepFace is unavailable; refusing to fall back to color histogram matching.")
    return {
        "isMatch": False,
        "similarity": 0,
        "distance": 1.0,
        "model": "Unavailable",
        "detector": "none",
        "error": "Dịch vụ so khớp khuôn mặt chưa sẵn sàng trong môi trường Python hiện tại (thiếu DeepFace).",
    }

def _decode_image(image_bytes: bytes, prefix: str) -> np.ndarray:
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Không thể đọc tệp ảnh {prefix}. Vui lòng chụp lại hoặc chọn ảnh khác.")
    return img

def _save_cv_temp(img: np.ndarray, prefix: str) -> str:
    fd, path = tempfile.mkstemp(suffix=".jpg", prefix=f"ekyc_{prefix}_")
    os.close(fd)
    cv2.imwrite(path, img)
    return path

