import hmac
import re
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import __version__, transkrip
from .extract import ExtractError, extract_file
from .generate import GenError
from .generate import comfyui, higgsfield, video

TOKEN_HEADER = "X-Alfonso-Token"
KEY_HEADER = "X-Alfonso-Key"
HIGGSFIELD_URL = "https://api.higgsfield.ai"
# Folder vault yang boleh dibaca sidecar: file impor dan hasil generate.
READABLE = ("files", "generated")
ASSET_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


class ExtractRequest(BaseModel):
    path: str
    asset_id: str


class TranscribeRequest(ExtractRequest):
    model: str = transkrip.DEFAULT_MODEL


class ModelRequest(BaseModel):
    model: str = transkrip.DEFAULT_MODEL


class HiggsfieldSubmit(BaseModel):
    model: str
    arguments: dict[str, Any]
    reference_path: str | None = None
    reference_key: str = "image_url"


class HiggsfieldWait(BaseModel):
    request_id: str


class ComfySubmit(BaseModel):
    base_url: str
    workflow_path: str
    values: dict[str, str | int | float | None]
    reference_path: str | None = None


class EncodeVideo(BaseModel):
    frames_dir: str
    fps: int
    max_frames: int = video.MAX_FRAMES


class ComfyWait(BaseModel):
    base_url: str
    prompt_id: str


def err(status: int, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail})


def create_app(
    token: str,
    vault_root: str | None = None,
    models_root: str | None = None,
    higgsfield_url: str = HIGGSFIELD_URL,
    http_transport: httpx.BaseTransport | None = None,
    poll_delay: float = 3.0,
    wait_timeout: float = 15 * 60,
) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    expected = token.encode()
    root = Path(vault_root).resolve() if vault_root else None
    models = Path(models_root).resolve() if models_root else None

    @app.middleware("http")
    async def cek_token(request: Request, call_next):
        given = request.headers.get(TOKEN_HEADER, "")
        # Dibandingkan sebagai bytes: compare_digest pada str non-ASCII melempar TypeError.
        if not hmac.compare_digest(given.encode("utf-8", "surrogateescape"), expected):
            return JSONResponse(status_code=401, content={"detail": "token tidak valid"})
        return await call_next(request)

    @app.get("/health")
    def health():
        return {"status": "ok", "version": __version__}

    def vault_path(rel_path: str) -> Path | JSONResponse:
        if root is None:
            return err(503, "vault belum diatur")
        rel = Path(rel_path)
        # Hanya file di dalam vault/files/ dan vault/generated/ yang boleh dibaca.
        target = (root / rel).resolve()
        if rel.is_absolute() or not any(target.is_relative_to(root / d) for d in READABLE):
            return err(400, "path tidak diizinkan")
        if not target.is_file():
            return err(404, "file tidak ditemukan")
        return target

    def vault_file(req: ExtractRequest) -> Path | JSONResponse:
        if not ASSET_ID.match(req.asset_id):
            return err(400, "path tidak diizinkan")
        return vault_path(req.path)

    def hf_client(request: Request) -> higgsfield.SyncClient:
        key = request.headers.get(KEY_HEADER, "")
        if not key or len(key) > 1100:
            raise GenError(400, "Kunci Higgsfield belum diatur.")
        return higgsfield.make_client(key, higgsfield_url, http_transport)

    @app.exception_handler(GenError)
    async def gen_error(_request: Request, e: GenError):
        return err(e.status, e.detail)

    @app.post("/generate/higgsfield/submit")
    def hf_submit(req: HiggsfieldSubmit, request: Request):
        client = hf_client(request)
        ref = None
        if req.reference_path:
            ref = vault_path(req.reference_path)
            if isinstance(ref, JSONResponse):
                return ref
        if not re.match(r"^[A-Za-z_][\w-]{0,39}$", req.reference_key):
            return err(400, "nama parameter referensi tidak valid")
        return {"request_id": higgsfield.submit(client, req.model, req.arguments, ref, req.reference_key)}

    @app.post("/generate/higgsfield/wait")
    def hf_wait(req: HiggsfieldWait, request: Request):
        client = hf_client(request)
        path = higgsfield.wait(client, req.request_id, wait_timeout, poll_delay, http_transport)
        return {"path": str(path), "ext": path.suffix.lstrip("."), "temp_dir": str(path.parent)}

    @app.post("/encode/video")
    def encode_video(req: EncodeVideo):
        path = video.encode(req.frames_dir, req.fps, min(req.max_frames, video.MAX_FRAMES))
        return {"path": str(path), "ext": "mp4", "temp_dir": str(path.parent)}

    @app.get("/generate/comfyui/status")
    def comfy_status(base_url: str):
        comfyui.check_url(base_url)
        return {"berjalan": comfyui.is_running(base_url, http_transport)}

    @app.post("/generate/comfyui/submit")
    def comfy_submit(req: ComfySubmit):
        wf = vault_path(req.workflow_path)
        if isinstance(wf, JSONResponse):
            return wf
        ref = None
        if req.reference_path:
            ref = vault_path(req.reference_path)
            if isinstance(ref, JSONResponse):
                return ref
        return {"prompt_id": comfyui.submit(req.base_url, wf, req.values, ref, http_transport)}

    @app.post("/generate/comfyui/wait")
    def comfy_wait(req: ComfyWait):
        path = comfyui.wait(req.base_url, req.prompt_id, wait_timeout, poll_delay, http_transport)
        return {"path": str(path), "ext": path.suffix.lstrip("."), "temp_dir": str(path.parent)}

    @app.post("/extract")
    def extract(req: ExtractRequest):
        target = vault_file(req)
        if isinstance(target, JSONResponse):
            return target
        try:
            return extract_file(target, req.asset_id, root / "thumbs")
        except ExtractError as e:
            return err(422, str(e))

    @app.get("/models/whisper")
    def whisper_status(model: str = transkrip.DEFAULT_MODEL):
        if models is None:
            return err(503, "folder model belum diatur")
        if model not in transkrip.MODELS:
            return err(400, "model tidak dikenal")
        return {"model": model, "siap": transkrip.is_ready(models, model), "pilihan": transkrip.MODELS}

    # Satu-satunya jalan sidecar mengunduh dari internet; dipanggil proses utama setelah pengguna setuju.
    @app.post("/models/whisper/download")
    def whisper_download(req: ModelRequest):
        if models is None:
            return err(503, "folder model belum diatur")
        if req.model not in transkrip.MODELS:
            return err(400, "model tidak dikenal")
        try:
            transkrip.download(models, req.model)
        except Exception as e:
            transkrip.log.warning("Unduh model gagal: %s", type(e).__name__)
            return err(502, "Unduh model gagal. Periksa koneksi internet lalu coba lagi.")
        return {"model": req.model, "siap": True}

    @app.post("/transcribe")
    def transcribe(req: TranscribeRequest):
        if models is None:
            return err(503, "folder model belum diatur")
        if req.model not in transkrip.MODELS:
            return err(400, "model tidak dikenal")
        target = vault_file(req)
        if isinstance(target, JSONResponse):
            return target
        try:
            return transkrip.transcribe(models, req.model, target)
        except transkrip.ModelMissing:
            return err(409, "Model transkrip belum diunduh")
        except transkrip.TranscribeError:
            return err(422, "Transkrip gagal")

    return app
