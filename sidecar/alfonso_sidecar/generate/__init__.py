"""Adapter generate (spec 6): Higgsfield (cloud), ComfyUI (lokal), dan perakit video untuk jalur kode."""

import mimetypes
import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import httpx

MAX_DOWNLOAD = 500 * 1024 * 1024

EXT_BY_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
}


class GenError(Exception):
    """status: 403 kunci ditolak, 422 permanen (jangan coba ulang), 502/503/504 sementara."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def temp_dir() -> Path:
    # Prefiks ini yang dicek proses utama sebelum menghapus folder sementara.
    return Path(tempfile.mkdtemp(prefix="alfonso-gen-"))


def ext_for(content_type: str | None, url: str) -> str:
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in EXT_BY_MIME:
        return EXT_BY_MIME[ct]
    suffix = Path(urlparse(url).path).suffix.lower().lstrip(".")
    if suffix in EXT_BY_MIME.values() or suffix == "jpeg":
        return "jpg" if suffix == "jpeg" else suffix
    guessed = mimetypes.guess_extension(ct) if ct else None
    return (guessed or ".bin").lstrip(".")


SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def download(http: httpx.Client, url: str, out: Path, stem: str = "hasil", **kw) -> Path:
    """Mengunduh satu file hasil ke `out` dengan batas ukuran."""
    with http.stream("GET", url, **kw) as r:
        if r.status_code >= 400:
            raise GenError(502, f"Hasil tidak bisa diunduh (HTTP {r.status_code}).")
        target = out / f"{SAFE_NAME.sub('-', stem)}.{ext_for(r.headers.get('content-type'), url)}"
        size = 0
        with open(target, "wb") as f:
            for chunk in r.iter_bytes():
                size += len(chunk)
                if size > MAX_DOWNLOAD:
                    raise GenError(422, "Hasil terlalu besar (maks. 500 MB).")
                f.write(chunk)
    return target
