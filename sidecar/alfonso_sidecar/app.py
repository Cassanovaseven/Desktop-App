import hmac
import re
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import __version__
from .extract import ExtractError, extract_file

TOKEN_HEADER = "X-Alfonso-Token"
ASSET_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


class ExtractRequest(BaseModel):
    path: str
    asset_id: str


def create_app(token: str, vault_root: str | None = None) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    expected = token.encode()
    root = Path(vault_root).resolve() if vault_root else None

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

    @app.post("/extract")
    def extract(req: ExtractRequest):
        if root is None:
            return JSONResponse(status_code=503, content={"detail": "vault belum diatur"})
        rel = Path(req.path)
        # Hanya file di dalam vault/files/ yang boleh dibaca.
        target = (root / rel).resolve()
        files_dir = root / "files"
        if rel.is_absolute() or not target.is_relative_to(files_dir) or not ASSET_ID.match(req.asset_id):
            return JSONResponse(status_code=400, content={"detail": "path tidak diizinkan"})
        if not target.is_file():
            return JSONResponse(status_code=404, content={"detail": "file tidak ditemukan"})
        try:
            return extract_file(target, req.asset_id, root / "thumbs")
        except ExtractError as e:
            return JSONResponse(status_code=422, content={"detail": str(e)})

    return app
