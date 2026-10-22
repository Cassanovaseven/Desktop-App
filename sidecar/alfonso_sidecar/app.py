import hmac

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import __version__

TOKEN_HEADER = "X-Alfonso-Token"


def create_app(token: str) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    expected = token.encode()

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

    return app
