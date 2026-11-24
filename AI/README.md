---
title: LanCare Hub AI eKYC
emoji: 🌿
colorFrom: green
colorTo: blue
sdk: gradio
app_file: app.py
pinned: false
---

# LanCare Hub — AI eKYC Service

Self-hosted AI microservice for eKYC processing in **LanCare Hub**:
- **Vietnamese CCCD OCR**: `EasyOCR` (`vi`, `en`)
- **Face Matching**: `DeepFace` (`ArcFace`)
- **Anti-Fraud & Selfie Liveness**: `OpenCV` (ELA + Moiré + LBP)

## Endpoints
- `GET /` & `GET /health` — Service health check
- `GET /docs` — Interactive Swagger UI
- `POST /api/ocr` — Extract Vietnamese CCCD fields
- `POST /api/face-match` — Match ID card portrait vs. selfie
- `POST /api/anti-fraud` — Document tamper & selfie liveness detection
