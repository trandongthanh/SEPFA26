import cv2
import numpy as np
from PIL import Image, ImageChops
import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ===== Thresholds =====
ELA_THRESHOLD = 40          # Max difference score indicating potential tampering
MOIRE_THRESHOLD = 0.25      # High-frequency ratio indicating screen recapture  
LBP_SPOOF_THRESHOLD = 0.45  # LBP texture variance indicating printed/screen photo


def analyze_document_fraud(image_bytes: bytes) -> dict:
    """
    Comprehensive anti-fraud analysis for ID document images.
    Combines 3 detection methods:
    1. ELA (Error Level Analysis) - detects photoshopped/edited images
    2. Moiré Pattern Detection - detects photos taken from screens
    3. Edge Consistency Analysis - detects cut-and-paste forgery
    
    Returns:
        dict with overall fraud_score (0-100, higher = more likely fraud),
        individual scores, and pass/fail verdict.
    """
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {'error': 'Cannot decode image', 'fraud_score': 0, 'passed': True}
        
        pil_image = Image.open(io.BytesIO(image_bytes))
        
        # 1. ELA Analysis
        ela_result = _ela_analysis(pil_image)
        
        # 2. Moiré Pattern Detection  
        moire_result = _moire_detection(img)
        
        # 3. Edge Consistency Analysis
        edge_result = _edge_consistency(img)
        
        # Calculate overall fraud score (weighted average)
        # Each sub-score is 0-100 (higher = more suspicious)
        fraud_score = (
            ela_result['score'] * 0.4 +      # ELA has highest weight
            moire_result['score'] * 0.35 +    # Moiré is strong indicator
            edge_result['score'] * 0.25       # Edge is supplementary
        )
        
        passed = fraud_score < 50  # Under 50 = likely genuine
        
        result = {
            'fraud_score': round(fraud_score, 2),
            'passed': passed,
            'verdict': 'GENUINE' if passed else 'SUSPICIOUS',
            'details': {
                'ela': ela_result,
                'moire': moire_result,
                'edge_consistency': edge_result,
            },
            'error': None
        }
        
        logger.info(
            f"Document fraud analysis: score={fraud_score:.1f}, "
            f"verdict={'GENUINE' if passed else 'SUSPICIOUS'}"
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Document fraud analysis error: {e}")
        return {
            'fraud_score': 0,
            'passed': True,  # Don't block on error
            'verdict': 'UNKNOWN',
            'details': {},
            'error': str(e)
        }


def analyze_selfie_liveness(image_bytes: bytes) -> dict:
    """
    Anti-spoofing analysis for selfie images.
    Detects if the selfie is a real person or a printed photo / screen display.
    
    Uses LBP (Local Binary Pattern) texture analysis - 
    printed photos and screens have different micro-texture patterns than real skin.
    
    Returns:
        dict with liveness_score (0-100, higher = more likely real),
        is_live boolean, and analysis details.
    """
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {'error': 'Cannot decode image', 'liveness_score': 100, 'is_live': True}
        
        # 1. LBP Texture Analysis
        lbp_result = _lbp_texture_analysis(img)
        
        # 2. Color Distribution Analysis  
        color_result = _color_distribution_analysis(img)
        
        # 3. Reflection/Glare Detection
        reflection_result = _reflection_detection(img)
        
        # Combine scores (higher = more likely REAL)
        liveness_score = (
            lbp_result['realness'] * 0.5 +
            color_result['realness'] * 0.3 +
            reflection_result['realness'] * 0.2
        )
        
        is_live = liveness_score >= 50
        
        result = {
            'liveness_score': round(liveness_score, 2),
            'is_live': is_live,
            'verdict': 'REAL' if is_live else 'SPOOF',
            'details': {
                'lbp_texture': lbp_result,
                'color_distribution': color_result,
                'reflection': reflection_result,
            },
            'error': None
        }
        
        logger.info(
            f"Selfie liveness analysis: score={liveness_score:.1f}, "
            f"verdict={'REAL' if is_live else 'SPOOF'}"
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Selfie liveness analysis error: {e}")
        return {
            'liveness_score': 100,
            'is_live': True,  # Don't block on error
            'verdict': 'UNKNOWN',
            'details': {},
            'error': str(e)
        }


# ============================================================
#  PRIVATE: ELA (Error Level Analysis)
# ============================================================

def _ela_analysis(pil_image: Image.Image, quality: int = 90) -> dict:
    """
    Error Level Analysis detects image manipulation.
    Re-saves the image at a known quality and compares the error levels.
    Manipulated regions show different error levels than original regions.
    """
    try:
        # Re-save at specified quality
        buffer = io.BytesIO()
        # Convert to RGB if needed (some images are RGBA/P mode)
        rgb_image = pil_image.convert('RGB')
        rgb_image.save(buffer, 'JPEG', quality=quality)
        buffer.seek(0)
        resaved = Image.open(buffer)
        
        # Calculate pixel-level difference
        ela_image = ImageChops.difference(rgb_image, resaved)
        
        # Analyze the difference
        ela_array = np.array(ela_image)
        
        # Calculate statistics
        max_diff = float(ela_array.max())
        mean_diff = float(ela_array.mean())
        std_diff = float(ela_array.std())
        
        # High std_diff relative to mean suggests non-uniform compression
        # which indicates potential manipulation
        if mean_diff > 0:
            coefficient_of_variation = std_diff / mean_diff
        else:
            coefficient_of_variation = 0
        
        # Score: 0-100 (higher = more suspicious)
        # Normal images have low, uniform ELA. Edited images have high variance.
        score = min(100, coefficient_of_variation * 30 + max_diff * 0.5)
        
        return {
            'score': round(score, 2),
            'max_difference': round(max_diff, 2),
            'mean_difference': round(mean_diff, 2),
            'std_difference': round(std_diff, 2),
            'description': 'Phân tích mức lỗi nén ảnh (ELA) — phát hiện vùng bị chỉnh sửa Photoshop'
        }
    except Exception as e:
        logger.warning(f"ELA analysis failed: {e}")
        return {'score': 0, 'description': f'ELA analysis error: {e}'}


# ============================================================
#  PRIVATE: Moiré Pattern Detection
# ============================================================

def _moire_detection(img: np.ndarray) -> dict:
    """
    Detect moiré patterns that appear when photographing screens.
    Uses FFT (Fast Fourier Transform) to find periodic high-frequency noise.
    """
    try:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Apply FFT
        f_transform = np.fft.fft2(gray.astype(float))
        f_shift = np.fft.fftshift(f_transform)
        magnitude = 20 * np.log(np.abs(f_shift) + 1)
        
        # Analyze frequency distribution
        h, w = magnitude.shape
        center_y, center_x = h // 2, w // 2
        
        # Create masks for low and high frequency regions
        # Low frequency = center of FFT (radius < 30% of image)
        radius_low = min(h, w) * 0.15
        radius_high = min(h, w) * 0.45
        
        y_coords, x_coords = np.ogrid[:h, :w]
        dist_from_center = np.sqrt((y_coords - center_y)**2 + (x_coords - center_x)**2)
        
        low_freq_mask = dist_from_center <= radius_low
        high_freq_mask = (dist_from_center > radius_low) & (dist_from_center <= radius_high)
        
        low_freq_energy = float(magnitude[low_freq_mask].mean()) if low_freq_mask.any() else 0
        high_freq_energy = float(magnitude[high_freq_mask].mean()) if high_freq_mask.any() else 0
        
        # Moiré produces periodic peaks in mid-high frequencies
        # Normal photos have smooth falloff from low to high
        if low_freq_energy > 0:
            freq_ratio = high_freq_energy / low_freq_energy
        else:
            freq_ratio = 0
        
        # Score: 0-100 (higher = more likely screen recapture)
        score = min(100, max(0, (freq_ratio - 0.15) * 200))
        
        return {
            'score': round(score, 2),
            'frequency_ratio': round(freq_ratio, 4),
            'low_freq_energy': round(low_freq_energy, 2),
            'high_freq_energy': round(high_freq_energy, 2),
            'description': 'Phát hiện vân moiré — dấu hiệu ảnh chụp lại từ màn hình'
        }
    except Exception as e:
        logger.warning(f"Moiré detection failed: {e}")
        return {'score': 0, 'description': f'Moiré detection error: {e}'}


# ============================================================
#  PRIVATE: Edge Consistency Analysis
# ============================================================

def _edge_consistency(img: np.ndarray) -> dict:
    """
    Analyze edge consistency to detect cut-and-paste forgery.
    Genuine ID cards have consistent edge quality throughout.
    Forged cards may have inconsistent edges where elements were pasted.
    """
    try:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Apply Canny edge detection
        edges = cv2.Canny(gray, 50, 150)
        
        # Divide image into grid blocks and analyze edge density
        block_size = 64
        h, w = edges.shape
        
        edge_densities = []
        for y in range(0, h - block_size, block_size):
            for x in range(0, w - block_size, block_size):
                block = edges[y:y+block_size, x:x+block_size]
                density = float(np.sum(block > 0)) / (block_size * block_size)
                edge_densities.append(density)
        
        if not edge_densities:
            return {'score': 0, 'description': 'Image too small for edge analysis'}
        
        densities = np.array(edge_densities)
        mean_density = float(densities.mean())
        std_density = float(densities.std())
        
        # High variation in edge density may indicate tampering
        if mean_density > 0:
            cv_density = std_density / mean_density
        else:
            cv_density = 0
        
        # Score: 0-100 (higher = more suspicious)
        # Normal ID cards have moderate, consistent edge density
        score = min(100, max(0, (cv_density - 1.0) * 40))
        
        return {
            'score': round(score, 2),
            'mean_edge_density': round(mean_density, 4),
            'std_edge_density': round(std_density, 4),
            'coefficient_of_variation': round(cv_density, 4),
            'description': 'Phân tích tính nhất quán viền — phát hiện cắt ghép ảnh'
        }
    except Exception as e:
        logger.warning(f"Edge consistency analysis failed: {e}")
        return {'score': 0, 'description': f'Edge analysis error: {e}'}


# ============================================================
#  PRIVATE: LBP Texture Analysis (for Liveness)
# ============================================================

def _lbp_texture_analysis(img: np.ndarray) -> dict:
    """
    Local Binary Pattern texture analysis for face anti-spoofing.
    Real faces have natural skin micro-texture.
    Printed photos / screens have different texture patterns (dot matrix, pixel grid).
    """
    try:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Resize to standard size for consistent analysis
        gray = cv2.resize(gray, (256, 256))
        
        # Simple LBP computation
        h, w = gray.shape
        lbp = np.zeros((h-2, w-2), dtype=np.uint8)
        
        for i in range(1, h-1):
            for j in range(1, w-1):
                center = gray[i, j]
                code = 0
                code |= (1 << 7) if gray[i-1, j-1] >= center else 0
                code |= (1 << 6) if gray[i-1, j] >= center else 0
                code |= (1 << 5) if gray[i-1, j+1] >= center else 0
                code |= (1 << 4) if gray[i, j+1] >= center else 0
                code |= (1 << 3) if gray[i+1, j+1] >= center else 0
                code |= (1 << 2) if gray[i+1, j] >= center else 0
                code |= (1 << 1) if gray[i+1, j-1] >= center else 0
                code |= (1 << 0) if gray[i, j-1] >= center else 0
                lbp[i-1, j-1] = code
        
        # Compute LBP histogram
        hist, _ = np.histogram(lbp.ravel(), bins=256, range=(0, 256))
        hist = hist.astype(float) / hist.sum()  # Normalize
        
        # Real faces have diverse LBP patterns (higher entropy)
        # Printed/screen photos have more uniform/periodic patterns (lower entropy)
        entropy = -np.sum(hist[hist > 0] * np.log2(hist[hist > 0]))
        
        # Higher entropy = more natural texture = more likely real
        # Real face: entropy typically 5.5-7.5
        # Printed/screen: entropy typically 3.5-5.5
        max_entropy = 8.0  # log2(256)
        realness = min(100, max(0, (entropy - 3.5) / (7.0 - 3.5) * 100))
        
        return {
            'realness': round(realness, 2),
            'entropy': round(entropy, 4),
            'description': 'Phân tích kết cấu LBP — phát hiện ảnh in hoặc màn hình'
        }
    except Exception as e:
        logger.warning(f"LBP texture analysis failed: {e}")
        return {'realness': 100, 'description': f'LBP analysis error: {e}'}


# ============================================================
#  PRIVATE: Color Distribution Analysis (for Liveness)
# ============================================================

def _color_distribution_analysis(img: np.ndarray) -> dict:
    """
    Analyze color distribution for liveness detection.
    Real faces have natural skin tone gradients.
    Printed photos have limited color depth; screens have characteristic color profiles.
    """
    try:
        # Convert to HSV for better skin tone analysis
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        
        # Analyze saturation channel
        saturation = hsv[:, :, 1].astype(float)
        sat_mean = float(saturation.mean())
        sat_std = float(saturation.std())
        
        # Analyze value (brightness) channel
        value = hsv[:, :, 2].astype(float)
        val_std = float(value.std())
        
        # Real faces have moderate saturation with natural variation
        # Screens tend to have higher saturation; prints tend to have lower
        # Natural lighting creates smooth brightness gradients
        
        sat_score = 100 - abs(sat_mean - 80) * 0.8  # Optimal around 80
        variation_score = min(100, sat_std * 2)  # Natural variation is good
        brightness_score = min(100, val_std * 1.5)  # Some brightness variation expected
        
        realness = (sat_score * 0.4 + variation_score * 0.3 + brightness_score * 0.3)
        realness = max(0, min(100, realness))
        
        return {
            'realness': round(realness, 2),
            'saturation_mean': round(sat_mean, 2),
            'saturation_std': round(sat_std, 2),
            'brightness_std': round(val_std, 2),
            'description': 'Phân tích phân bố màu sắc — phát hiện ảnh in hoặc màn hình'
        }
    except Exception as e:
        logger.warning(f"Color distribution analysis failed: {e}")
        return {'realness': 100, 'description': f'Color analysis error: {e}'}


# ============================================================
#  PRIVATE: Reflection/Glare Detection (for Liveness)
# ============================================================

def _reflection_detection(img: np.ndarray) -> dict:
    """
    Detect screen reflections or glare that indicate a photo of a screen.
    Screens often have bright spots (reflections) that real faces don't.
    """
    try:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Find very bright spots (potential reflections)
        _, bright_mask = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY)
        bright_ratio = float(np.sum(bright_mask > 0)) / (gray.shape[0] * gray.shape[1])
        
        # Also check for rectangular bright regions (screen edges)
        # Apply morphological operations to find rectangular bright areas
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (20, 20))
        bright_regions = cv2.morphologyEx(bright_mask, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(bright_regions, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        # Count large rectangular bright regions
        large_bright_regions = sum(1 for c in contours if cv2.contourArea(c) > 500)
        
        # Few/no bright spots and no large bright regions = likely real
        # Many bright spots or large bright regions = likely screen
        reflection_score = bright_ratio * 500 + large_bright_regions * 10
        realness = max(0, min(100, 100 - reflection_score))
        
        return {
            'realness': round(realness, 2),
            'bright_pixel_ratio': round(bright_ratio, 4),
            'large_bright_regions': large_bright_regions,
            'description': 'Phát hiện phản chiếu/chói — dấu hiệu ảnh chụp từ màn hình'
        }
    except Exception as e:
        logger.warning(f"Reflection detection failed: {e}")
        return {'realness': 100, 'description': f'Reflection detection error: {e}'}
