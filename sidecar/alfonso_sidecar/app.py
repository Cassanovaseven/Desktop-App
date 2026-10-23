import hmac
import re
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import __version__, transkrip
from .extract import ExtractError, extract_file

TOKEN_HEADER = "X-Alfonso-Token"
ASSET_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


class ExtractRequest(BaseModel):
    path: str
    asset_id: str


class TranscribeRequest(ExtractRequest):
    model: str = transkrip.DEFAULT_MODEL


class ModelRequest(BaseModel):
    model: str = transkrip.DEFAULT_MODEL


def err(status: int, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail})


def create_app(token: str, vault_root: str | None = None, models_root: str | None = None) -> FastAPI:
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

    def vault_file(req: ExtractRequest) -> Path | JSONResponse:
        if root is None:
            return err(503, "vault belum diatur")
        rel = Path(req.path)
        # Hanya file di dalam vault/files/ yang boleh dibaca.
        target = (root / rel).resolve()
        if rel.is_absolute() or not target.is_relative_to(root / "files") or not ASSET_ID.match(req.asset_id):
            return err(400, "path tidak diizinkan")
        if not target.is_file():
            return err(404, "file tidak ditemukan")
        return target

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
