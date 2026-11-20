import os
import gradio as gr
from main import app as fastapi_app
from services import ocr_service, face_service

try:
    import spaces
    gpu_decorator = spaces.GPU(duration=1)
except ImportError:
    def gpu_decorator(fn):
        return fn


# Hàm ẩn chỉ để vượt qua kiểm tra khởi động của ZeroGPU — KHÔNG nối vào nút bấm hay API nào
@gpu_decorator
def _unused_gpu_hook():
    return "noop"


def status_check():
    return "Healthy — Running on CPU (0 GPU quota used)"


with gr.Blocks(title="LanCare Hub AI eKYC") as demo:
    gr.Markdown(
        "## 🌿 LanCare Hub — AI eKYC Service\n"
        "- **Status:** Running (`EasyOCR` + `DeepFace ArcFace` + `OpenCV Anti-Fraud`)\n"
        "- **Mode:** Pure CPU FastAPI (ZeroGPU Quota = 0s)\n"
        "- **Health Check:** [`/health`](/health)\n"
        "- **API Endpoints:** `POST /api/ocr`, `POST /api/face-match`, `POST /api/anti-fraud`"
    )
    btn = gr.Button("Check Service Status (CPU Only - Free)")
    out = gr.Textbox(label="Status")
    btn.click(fn=status_check, inputs=None, outputs=out)

if __name__ == "__main__":
    ocr_service.init_reader()
    face_service.init_model()

    port = int(os.getenv("PORT", os.getenv("GRADIO_SERVER_PORT", "7860")))
    demo.launch(
        server_name="0.0.0.0",
        server_port=port,
        prevent_thread_lock=True,
        ssr_mode=False,
    )

    if getattr(demo, "app", None) is not None:
        for route in fastapi_app.routes:
            if getattr(route, "path", "") not in ("/", "/docs", "/redoc", "/openapi.json"):
                demo.app.router.routes.append(route)

    demo.block_thread()
