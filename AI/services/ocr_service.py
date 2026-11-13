import re
import unicodedata
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

def _fold_ascii(text: str) -> str:
    """Normalize Vietnamese text to uppercase ASCII for resilient keyword matching."""
    text = text.replace('đ', 'd').replace('Đ', 'D')
    nfkd = unicodedata.normalize('NFKD', text)
    return ''.join(c for c in nfkd if not unicodedata.combining(c)).upper()

BACK_SIDE_KEYWORDS = (
    'DAC DIEM NHAN DANG',
    'PERSONAL IDENTIFICATION',
    'NGON TRO',
    'LEFT INDEX',
    'RIGHT INDEX',
    'CUC TRUONG',
    'QUAN LY HANH CHINH',
    'TRAT TU XA HOI',
    'VAN TAY',
    'DATE, MONTH, YEAR',
    'NGAY, THANG, NAM',
)

FRONT_SIDE_KEYWORDS = (
    'CONG HOA',
    'CAN CUOC',
    'CITIZEN',
    'CHUNG MINH',
    'HO VA TEN',
    'FULL NAME',
    'NGAY SINH',
    'DATE OF BIRTH',
    'GIOI TINH',
    'QUOC TICH',
    'NATIONALITY',
    'QUE QUAN',
    'PLACE OF ORIGIN',
    'THUONG TRU',
    'RESIDENCE',
    'GIA TRI DEN',
    'EXPIRY',
)

NON_PERSON_NAME_KEYWORDS = (
    'CONG HOA',
    'XA HOI',
    'CHU NGHIA',
    'VIET NAM',
    'DOC LAP',
    'TU DO',
    'HANH PHUC',
    'CAN CUOC',
    'CITIZEN',
    'IDENTITY',
    'CHUNG MINH',
    'CUC TRUONG',
    'CANH SAT',
    'QUAN LY',
    'HANH CHINH',
    'TRAT TU',
    'DAC DIEM',
    'NHAN DANG',
    'NGON TRO',
    'HO VA TEN',
    'FULL NAME',
    'NGAY SINH',
    'DATE OF BIRTH',
    'GIOI TINH',
    'QUOC TICH',
    'QUE QUAN',
    'THUONG TRU',
)

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

def _validate_front_cccd(all_text: str) -> Optional[str]:
    """Ensure the uploaded OCR image is the FRONT side of a Vietnamese ID card."""
    folded = _fold_ascii(all_text)
    has_mrz = bool(re.search(r'IDVNM|<{3,}', folded))
    back_hits = sum(1 for kw in BACK_SIDE_KEYWORDS if kw in folded)
    front_hits = sum(1 for kw in FRONT_SIDE_KEYWORDS if kw in folded)

    if has_mrz or (back_hits >= 1 and front_hits < 3):
        logger.warning(f"Rejected back-side CCCD uploaded to front OCR (mrz={has_mrz}, back_hits={back_hits}, front_hits={front_hits})")
        return "Đây là ảnh mặt sau thẻ CCCD. Vui lòng chụp hoặc tải lên ảnh MẶT TRƯỚC thẻ CCCD (mặt có ảnh chân dung và họ tên)."

    if front_hits < 3:
        logger.warning(f"Rejected incomplete/non-front CCCD image (front_hits={front_hits})")
        return "Ảnh mặt trước CCCD chưa đầy đủ hoặc quá mờ. Vui lòng chụp rõ toàn bộ 4 góc mặt trước thẻ CCCD."

    return None

def _has_clipped_text(text_lines: List[Dict], img_w: int, img_h: int) -> bool:
    """Detect if card text boxes are clipped right against the right or bottom image edge."""
    if img_w <= 0 or img_h <= 0:
        return False
    right_margin = img_w * 0.992
    bottom_margin = img_h * 0.992
    clipped_right = sum(1 for t in text_lines if t.get('x_max', 0) >= right_margin)
    clipped_bottom = sum(1 for t in text_lines if t.get('y_max', 0) >= bottom_margin)
    return clipped_right >= 2 or clipped_bottom >= 2

def _extract_with_easyocr(image_bytes: bytes) -> dict:
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return {"error": "Không thể đọc tệp ảnh. Vui lòng chụp lại hoặc chọn ảnh rõ nét định dạng JPG/PNG."}

    img_h, img_w = img.shape[:2]
    results = reader.readtext(img, detail=1, paragraph=False)
    text_lines = []
    for (bbox, text, conf) in results:
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        y_center = (min(ys) + max(ys)) / 2
        x_center = (min(xs) + max(xs)) / 2
        cleaned = _clean_text(text)
        if cleaned:
            text_lines.append({
                'text': cleaned,
                'y': y_center,
                'x': x_center,
                'x_min': min(xs),
                'x_max': max(xs),
                'y_min': min(ys),
                'y_max': max(ys),
                'confidence': float(conf)
            })

    # Sort text lines top-to-bottom
    text_lines.sort(key=lambda t: t['y'])
    all_text = ' '.join([t['text'] for t in text_lines])
    all_text_upper = all_text.upper()

    # Validate front side vs back side / non-ID images before extracting fields
    validation_err = _validate_front_cccd(all_text)
    if validation_err:
        return {"error": validation_err}

    doc_type = _detect_doc_type(all_text_upper)

    # Extract fields with specialized logic for Vietnamese CCCD
    id_number = _extract_id_number(text_lines, all_text, doc_type)
    full_name = _extract_name(text_lines)
    dob, expiry = _extract_dates(text_lines, all_text)
    gender = _extract_gender(all_text)
    nationality = 'Việt Nam'
    origin = _extract_origin(text_lines)
    residence = _extract_residence(text_lines)

    # Bắt buộc ảnh phải đầy đủ: không bị mất góc/cắt mất số CCCD, ngày sinh, họ tên hoặc phần dưới thẻ
    missing_fields = []
    if not id_number:
        missing_fields.append("đủ 12 số CCCD")
    if not full_name:
        missing_fields.append("họ và tên")
    if not dob:
        missing_fields.append("ngày sinh đầy đủ")

    folded_all = _fold_ascii(all_text)
    has_chip_bottom_labels = ('QUE QUAN' in folded_all or 'THUONG TRU' in folded_all or 'PLACE OF ORIGIN' in folded_all or 'PLACE OF RESIDENCE' in folded_all)
    if has_chip_bottom_labels and not (origin or residence):
        missing_fields.append("quê quán / nơi thường trú")

    if missing_fields or _has_clipped_text(text_lines, img_w, img_h):
        logger.warning(
            f"Rejected incomplete/cropped front CCCD: missing={missing_fields}, "
            f"clipped={_has_clipped_text(text_lines, img_w, img_h)}, id={bool(id_number)}, dob={dob}"
        )
        return {
            "error": "Ảnh mặt trước CCCD bị mất góc, thiếu thông tin hoặc chưa đủ rõ (cần thấy rõ 4 góc thẻ, đủ 12 số CCCD, họ tên và ngày sinh). Vui lòng chụp lại toàn bộ thẻ."
        }

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

def _extract_id_number(text_lines: List[Dict], all_text: str, doc_type: str = 'CCCD') -> Optional[str]:
    """Extract exact 12-digit CCCD number (or 9-digit CMND only if card is CMND)."""
    # CCCD bắt buộc phải đủ 12 chữ số liên tiếp (không nhận số bị cắt còn 9-11 chữ số)
    match12 = re.search(r'(?<!\d)(\d{12})(?!\d)', all_text)
    if match12:
        return match12.group(1)

    for line in text_lines:
        digits = re.findall(r'(?<!\d)\d{12}(?!\d)', line['text'])
        if digits:
            return digits[0]

    if doc_type == 'CMND':
        match9 = re.search(r'(?<!\d)(\d{9})(?!\d)', all_text)
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
        # Filter out label lines and institutional header text
        t_folded = _fold_ascii(t)
        if any(lbl in t_folded for lbl in NON_PERSON_NAME_KEYWORDS):
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
