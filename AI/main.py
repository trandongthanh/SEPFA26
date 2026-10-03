import logging
import time
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
import asyncio

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from services import ocr_service, face_service, fraud_service

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
logger = logging.getLogger(__name__)

# Thread pool for CPU-bound ML tasks
executor = ThreadPoolExecutor(max_workers=4)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Pre-load ML models on startup."""
    logger.info("=" * 60)
    logger.info("LanCare Hub AI eKYC Service - Starting up...")
    logger.info("=" * 60)
    
    # Pre-load models in background thread
    loop = asyncio.get_event_loop()
    
    logger.info("[1/2] Loading EasyOCR reader (vi, en)...")
    await loop.run_in_executor(executor, ocr_service.init_reader)
    
    logger.info("[2/2] Loading DeepFace model (ArcFace)...")
    await loop.run_in_executor(executor, face_service.init_model)
    
    logger.info("=" * 60)
    logger.info("All models loaded. Service ready!")
    logger.info("=" * 60)
    
    yield
    
    logger.info("AI eKYC Service shutting down...")
    executor.shutdown(wait=False)


app = FastAPI(
    title='LanCare Hub - AI eKYC Service',
    description=(
        'Self-hosted AI microservice for eKYC processing. '
        'Replaces FPT.AI with open-source libraries: '
        'EasyOCR (Vietnamese OCR), DeepFace (Face Matching), '
        'OpenCV (Anti-Fraud Detection).'
    ),
    version='1.0.0',
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


# ================================================================
#  Health Check
# ================================================================

@app.get('/health')
async def health_check():
    return {
        'status': 'healthy',
        'service': 'LanCare Hub AI eKYC',
        'version': '1.0.0',
        'models': {
            'ocr': 'EasyOCR (vi, en)',
            'face_match': 'DeepFace (ArcFace)',
            'anti_fraud': 'OpenCV (ELA + Moiré + LBP)',
        }
    }


# ================================================================
#  POST /api/ocr — Vietnamese CCCD OCR
# ================================================================

@app.post('/api/ocr')
async def ocr_endpoint(file: UploadFile = File(...)):
    """
    Extract information from Vietnamese CCCD (Citizen ID Card).
    Accepts a single image file (JPEG, PNG).
    Returns structured data: id_number, full_name, date_of_birth, gender, etc.
    """
    start = time.time()
    
    try:
        image_bytes = await file.read()
        if len(image_bytes) == 0:
            raise HTTPException(status_code=400, detail='Empty file uploaded')
        
        # Run OCR in thread pool (CPU-bound)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            executor, ocr_service.extract_cccd_info, image_bytes
        )
        
        elapsed = time.time() - start
        logger.info(f"OCR completed in {elapsed:.2f}s")
        
        if 'error' in result and result.get('error'):
            raise HTTPException(status_code=400, detail=result['error'])
        
        return {
            'success': True,
            'data': result,
            'processing_time_ms': round(elapsed * 1000),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"OCR endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
#  POST /api/face-match — Face Comparison
# ================================================================

@app.post('/api/face-match')
async def face_match_endpoint(
    id_card: UploadFile = File(..., description='CCCD front image'),
    selfie: UploadFile = File(..., description='Selfie image'),
):
    """
    Compare face in CCCD image with selfie.
    Returns: isMatch (bool), similarity (%), distance.
    """
    start = time.time()
    
    try:
        id_card_bytes = await id_card.read()
        selfie_bytes = await selfie.read()
        
        if len(id_card_bytes) == 0 or len(selfie_bytes) == 0:
            raise HTTPException(status_code=400, detail='Both images are required')
        
        # Run face matching in thread pool (CPU-bound)
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            executor, face_service.compare_faces, id_card_bytes, selfie_bytes
        )
        
        elapsed = time.time() - start
        logger.info(f"Face match completed in {elapsed:.2f}s")
        
        if result.get('error'):
            return JSONResponse(
                status_code=200,
                content={
                    'success': False,
                    'data': result,
                    'processing_time_ms': round(elapsed * 1000),
                }
            )
        
        return {
            'success': True,
            'data': result,
            'processing_time_ms': round(elapsed * 1000),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Face match endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
#  POST /api/anti-fraud — Document Fraud + Selfie Liveness
# ================================================================

@app.post('/api/anti-fraud')
async def anti_fraud_endpoint(
    document: UploadFile = File(None, description='ID document image (optional)'),
    selfie: UploadFile = File(None, description='Selfie image (optional)'),
):
    """
    Comprehensive anti-fraud analysis:
    - If document is provided: checks for editing, screen recapture, forgery
    - If selfie is provided: checks liveness (real person vs printed/screen photo)
    - Both can be provided for full analysis
    """
    start = time.time()
    
    try:
        result = {}
        loop = asyncio.get_event_loop()
        
        if document:
            doc_bytes = await document.read()
            if doc_bytes:
                result['document_fraud'] = await loop.run_in_executor(
                    executor, fraud_service.analyze_document_fraud, doc_bytes
                )
        
        if selfie:
            selfie_bytes = await selfie.read()
            if selfie_bytes:
                result['selfie_liveness'] = await loop.run_in_executor(
                    executor, fraud_service.analyze_selfie_liveness, selfie_bytes
                )
        
        if not result:
            raise HTTPException(
                status_code=400,
                detail='At least one image (document or selfie) is required'
            )
        
        # Overall pass/fail
        doc_passed = result.get('document_fraud', {}).get('passed', True)
        selfie_passed = result.get('selfie_liveness', {}).get('is_live', True)
        
        elapsed = time.time() - start
        logger.info(f"Anti-fraud analysis completed in {elapsed:.2f}s")
        
        return {
            'success': True,
            'overall_passed': doc_passed and selfie_passed,
            'data': result,
            'processing_time_ms': round(elapsed * 1000),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Anti-fraud endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ================================================================
#  Run with uvicorn
# ================================================================

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('main:app', host='0.0.0.0', port=8000, reload=False, workers=1)
