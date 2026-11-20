FROM python:3.11-slim

# Install system dependencies for OpenCV, EasyOCR, and DeepFace
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    gcc \
    g++ \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (UID 1000 is required by Hugging Face Spaces)
RUN useradd -m -u 1000 user

WORKDIR /app

# Install Python dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and set ownership for UID 1000
COPY --chown=user:user . .

# Switch to non-root user and configure model cache directories
USER user
ENV HOME=/home/user \
    PATH="/home/user/.local/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    EASYOCR_MODULE_PATH=/home/user/.EasyOCR \
    DEEPFACE_HOME=/home/user

# Pre-download EasyOCR (vi, en) and DeepFace (ArcFace) models during build
# to prevent cold-start timeouts on Hugging Face Spaces
RUN python -c "import easyocr; easyocr.Reader(['vi', 'en'], gpu=False)" && \
    python -c "from deepface import DeepFace; DeepFace.build_model('ArcFace')"

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
