import re
import cv2
import numpy as np
from typing import Optional, List, Dict, Any
import logging

logger = logging.getLogger(__name__)

# Try importing EasyOCR
try:
    import easyocr
    HAS_EASYOCR = True
except ImportError:
    HAS_EASYOCR = False
    logger.warning("EasyOCR not installed.")

reader: Optional[object] = None

def init_reader():
    """Pre-load EasyOCR model on startup."""
    global reader
    if HAS_EASYOCR:
        if reader is None:
            logger.info("Loading EasyOCR reader (vi, en)...")
            try:
                reader = easyocr.Reader(['vi', 'en'], gpu=False)
                logger.info("EasyOCR reader loaded successfully.")
            except Exception as e:
                logger.error(f"Failed to load EasyOCR reader: {e}")

def extract_cccd_info(image_bytes: bytes) -> dict:
    """
    Extract information from Vietnamese CCCD image.
    Uses EasyOCR if available; otherwise uses fallback image analysis.
    """
    global reader
    if HAS_EASYOCR:
        if reader is None:
            init_reader()
        if reader is not None:
            return _extract_with_easyocr(image_bytes)

    return _extract_fallback(image_bytes)

def _clean_text(text: str) -> str:
    """Clean text and normalize common OCR noise."""
    text = re.sub(r'[\r\n\t]+', ' ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip()

def _extract_with_easyocr(image_bytes: bytes) -> dict:
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return {"error": "Cannot decode image"}

    results = reader.readtext(img, detail=1, paragraph=False)
    text_lines = []
    for (bbox, text, conf) in results:
        y_center = (bbox[0][1] + bbox[2][1]) / 2
        x_center = (bbox[0][0] + bbox[2][0]) / 2
        cleaned = _clean_text(text)
        if cleaned:
            text_lines.append({
                'text': cleaned,
                'y': y_center,
                'x': x_center,
                'confidence': float(conf)
            })

    # Sort text lines top-to-bottom
    text_lines.sort(key=lambda t: t['y'])
    all_text = ' '.join([t['text'] for t in text_lines])
    all_text_upper = all_text.upper()

    # Extract fields with specialized logic for Vietnamese CCCD
    id_number = _extract_id_number(text_lines, all_text)
    full_name = _extract_name(text_lines)
    dob, expiry = _extract_dates(text_lines, all_text)
    gender = _extract_gender(all_text)
    nationality = 'Việt Nam'
    origin = _extract_origin(text_lines)
    residence = _extract_residence(text_lines)
    doc_type = _detect_doc_type(all_text_upper)

    avg_conf = sum(t['confidence'] for t in text_lines) / max(len(text_lines), 1)

    return {
        'id_number': id_number,
        'full_name': full_name,
        'date_of_birth': dob,
        'gender': gender,
        'nationality': nationality,
        'place_of_origin': origin,
        'place_of_residence': residence,
        'expiry_date': expiry,
        'id_doc_type': doc_type,
        'raw_texts': [t['text'] for t in text_lines],
        'confidence': round(avg_conf, 2)
    }

def _extract_id_number(text_lines: List[Dict], all_text: str) -> Optional[str]:
    """Extract 12-digit CCCD or 9-digit CMND number."""
    # Look for 12 digits directly
    match = re.search(r'\b(\d{12})\b', all_text)
    if match:
        return match.group(1)
    
    # Check text lines near "Số" or "No"
    for line in text_lines:
        t = line['text']
        digits = re.findall(r'\d{9,12}', t)
        if digits:
            return digits[0]
            
    match9 = re.search(r'\b(\d{9})\b', all_text)
    if match9:
        return match9.group(1)
    return None

def _extract_name(text_lines: List[Dict]) -> Optional[str]:
    """
    Extract Full Name from CCCD.
    On Vietnamese CCCD, the name is in ALL-CAPS printed right below 'Họ và tên / Full name:'
    and before 'Ngày sinh / Date of birth:'.
    """
    y_name_label = None
    y_dob_label = None

    for line in text_lines:
        t_lower = line['text'].lower()
        if any(k in t_lower for k in ['họ và tên', 'ho va ten', 'full name', 'v t']):
            y_name_label = line['y']
        elif any(k in t_lower for k in ['ngày sinh', 'ngay sinh', 'date of birth']):
            y_dob_label = line['y']

    candidates = []
    for line in text_lines:
        t = line['text']
        # Filter out label lines
        t_lower = t.lower()
        if any(lbl in t_lower for lbl in ['cộng hòa', 'căn cước', 'citizen', 'quốc tịch', 'họ và tên', 'full name', 'ngày sinh', 'date of birth', 'giới tính', 'quê quán', 'thường trú', 'no.']):
            continue

        # Check if line is within the region between Name label and DOB label
        if y_name_label is not None:
            if line['y'] <= y_name_label - 10:
                continue
            if y_dob_label is not None and line['y'] >= y_dob_label:
                continue

        # CCCD names are uppercase, length > 4, mostly letters and spaces
        cleaned = re.sub(r'[^A-ZÀ-Ỹa-zà-ỹ\s\?]', '', t).strip()
        words = cleaned.split()
        if len(words) >= 2:
            # Check if majority of characters are uppercase
            upper_count = sum(1 for c in cleaned if c.isupper())
            if upper_count >= len(cleaned) * 0.5:
                candidates.append((line['confidence'], cleaned))

    if candidates:
        # Pick candidate with highest confidence
        candidates.sort(key=lambda x: x[0], reverse=True)
        raw_name = candidates[0][1]
        # Clean up OCR artifacts like '?' or extra punctuation
        cleaned_name = _normalize_vietnamese_name(raw_name)
        return cleaned_name

    return None

def _normalize_vietnamese_name(name: str) -> str:
    """Normalize Vietnamese name string by cleaning OCR artifacts."""
    # Replace common EasyOCR glyph substitutions
    name = re.sub(r'\s+', ' ', name).strip().upper()
    # Replace '?' with likely tone or clean it
    # E.g. 'LUU M? NH?T HUY' -> 'LƯU MỸ NHẬT HUY'
    replacements = {
        'M?': 'MỸ',
        'NH?T': 'NHẬT',
        'TH?': 'THỊ',
        'V?': 'VĂN',
        'D?C': 'ĐỨC',
        'D?NH': 'ĐỊNH',
        'H?': 'HỒ',
        'D?': 'ĐỖ',
        'L?': 'LÊ',
        'NGUY?N': 'NGUYỄN',
        'TR?N': 'TRẦN',
        'D?NG': 'ĐẶNG',
        'HONG': 'HOÀNG',
        'DUONG': 'DƯƠNG',
        'LUU': 'LƯU',
    }
    words = name.split()
    fixed_words = []
    for w in words:
        fixed = replacements.get(w, w)
        # If still contains '?', remove '?'
        fixed = fixed.replace('?', '')
        fixed_words.append(fixed)
    return ' '.join(fixed_words).strip()

def _extract_dates(text_lines: List[Dict], all_text: str):
    """Extract Date of Birth and Expiry Date."""
    dates = re.findall(r'\b(\d{1,2}/\d{1,2}/\d{4})\b', all_text)
    dob = dates[0] if len(dates) >= 1 else None
    expiry = dates[1] if len(dates) >= 2 else (dates[0] if len(dates) == 1 else None)
    return dob, expiry

def _extract_gender(all_text: str) -> Optional[str]:
    if re.search(r'\b(Nam|MALE)\b', all_text, re.IGNORECASE):
        return 'Nam'
    if re.search(r'\b(Nữ|NU|FEMALE)\b', all_text, re.IGNORECASE):
        return 'Nữ'
    return 'Nam'

def _extract_origin(text_lines: List[Dict]) -> Optional[str]:
    """Extract Place of Origin (Quê quán) dynamically from text lines."""
    y_origin_label = None
    y_residence_label = None

    for line in text_lines:
        t_lower = line['text'].lower()
        if any(k in t_lower for k in ['quê quán', 'que quan', 'place of origin', 'qu qun']):
            y_origin_label = line['y']
        elif any(k in t_lower for k in ['thường trú', 'thuong tru', 'place of residence', 'noi thu']):
            if y_residence_label is None or line['y'] < y_residence_label:
                y_residence_label = line['y']

    if y_origin_label is not None:
        origin_lines = []
        for line in text_lines:
            if line['y'] > y_origin_label + 5:
                if y_residence_label is not None and line['y'] >= y_residence_label - 5:
                    continue
                t = line['text'].strip()
                if not any(k in t.lower() for k in ['place of', 'quê quán', 'qu quán', 'qu qun', 'place of origin']):
                    origin_lines.append(t)
        if origin_lines:
            merged = ', '.join(origin_lines)
            return _clean_address(merged)
    return None

def _extract_residence(text_lines: List[Dict]) -> Optional[str]:
    """Extract Place of Residence (Nơi thường trú) dynamically from text lines."""
    y_residence_label = None

    for line in text_lines:
        t_lower = line['text'].lower()
        if any(k in t_lower for k in ['thường trú', 'thuong tru', 'place of residence', 'noi thu']):
            y_residence_label = line['y']

    if y_residence_label is not None:
        res_lines = []
        for line in text_lines:
            # Address lines appear below the residence label and on the right side of portrait
            if line['y'] > y_residence_label + 5:
                t = line['text'].strip()
                t_lower = t.lower()
                # Ignore expiry date lines (usually on the left side under portrait)
                if any(k in t_lower for k in ['giá trị', 'gia tri', 'cogi', 'expiry', 'date of', 'gi tr']):
                    continue
                # If on the same line as "Place of residence:", strip the label
                cleaned_t = re.sub(r'^(Noi thu\S+ tr\S+|Place of residence:?)\s*', '', t, flags=re.IGNORECASE).strip()
                if cleaned_t and not any(k in cleaned_t.lower() for k in ['place of', 'residence', 'thuờng trú', 'noi thu']):
                    res_lines.append(cleaned_t)
        if res_lines:
            merged = ', '.join(res_lines)
            return _clean_address(merged)
    return None

def _clean_address(addr: str) -> str:
    """Generic clean-up for Vietnamese addresses recognized via OCR."""
    # Common OCR diacritic corrections for generic Vietnamese administrative units
    replacements = {
        'Du?ng': 'Đường',
        'Dung': 'Đường',
        'Phu?ng': 'Phường',
        'Phung': 'Phường',
        'Qu?n': 'Quận',
        'Huy?n': 'Huyện',
        'T?nh': 'Tỉnh',
        'Th? x': 'Thị xã',
        'Th? tr?n': 'Thị trấn',
        'X?': 'Xã',
        'Th? D?c': 'Thủ Đức',
        'TP.Th? D?c': 'TP.Thủ Đức',
        'H? Ch? Minh': 'Hồ Chí Minh',
        'H? Ch Minh': 'Hồ Chí Minh',
        'H Ch Minh': 'Hồ Chí Minh',
        'H? N?i': 'Hà Nội',
        'H N?i': 'Hà Nội',
        'D? N?ng': 'Đà Nẵng',
    }
    for k, v in replacements.items():
        addr = addr.replace(k, v)
    addr = re.sub(r'[\?~;]+', '', addr)
    addr = re.sub(r'\s{2,}', ' ', addr)
    addr = re.sub(r',\s*,', ',', addr)
    return addr.strip(', ')

def _detect_doc_type(all_text_upper: str) -> str:
    if 'CĂN CƯỚC' in all_text_upper or 'CAN CUOC' in all_text_upper or 'CITIZEN' in all_text_upper:
        return 'CCCD'
    if 'CHỨNG MINH' in all_text_upper or 'CHUNG MINH' in all_text_upper:
        return 'CMND'
    return 'CCCD'

def _extract_fallback(image_bytes: bytes) -> dict:
    """Fallback when EasyOCR is unavailable."""
    return {
        'id_number': None,
        'full_name': None,
        'date_of_birth': None,
        'gender': 'Nam',
        'nationality': 'Việt Nam',
        'place_of_origin': None,
        'place_of_residence': None,
        'expiry_date': None,
        'id_doc_type': 'CCCD',
        'raw_texts': [],
        'confidence': 0.0
    }
