"""Jalur cloud lewat SDK resmi `higgsfield-client` (spec 6). Kunci selalu dari argumen, tidak dari variabel lingkungan."""

import re
import time
from pathlib import Path
from typing import Any

import httpx
from higgsfield_client import NSFW, Cancelled, Completed, Failed, HiggsfieldClientError, SyncClient
from higgsfield_client.http.retry import NoRetry
from higgsfield_client.http.transport import HttpTransport

from . import GenError, download, temp_dir

MODEL_RE = re.compile(r"^[A-Za-z0-9][\w.\-]*(/[\w.\-]+)*$")
REQUEST_RE = re.compile(r"^[\w\-]{1,128}$")


def make_client(api_key: str, base_url: str, transport: httpx.BaseTransport | None = None, timeout: float = 120) -> SyncClient:
    client = SyncClient(base_url=base_url, api_key=api_key, timeout=timeout)
    if transport is not None:
        client.__dict__["_client"] = httpx.Client(
            transport=transport, base_url=base_url, timeout=timeout,
            headers={"Authorization": f"Key {api_key}", "Content-Type": "application/json"},
        )
        client.__dict__["_upload_client"] = httpx.Client(transport=transport, timeout=timeout)
    # Coba ulang diatur antrean Alfonso (maks. 2 kali, spec 7), bukan SDK.
    client.__dict__["_transport"] = HttpTransport(client._client, NoRetry())
    return client


def _status_of(e: HiggsfieldClientError) -> int | None:
    cause = e.__cause__
    return cause.response.status_code if isinstance(cause, httpx.HTTPStatusError) else None


def _translate(e: Exception) -> GenError:
    if isinstance(e, GenError):
        return e
    if isinstance(e, HiggsfieldClientError):
        code = _status_of(e)
        msg = str(e)[:300] or "tanpa pesan"
        if code in (401, 403):
            return GenError(403, "Kunci Higgsfield ditolak. Periksa API key dan secret di Studio → Akun.")
        if code == 402:
            return GenError(422, "Kredit Higgsfield tidak cukup.")
        if code is not None and 400 <= code < 500 and code not in (408, 429):
            return GenError(422, f"Higgsfield menolak permintaan: {msg}")
        return GenError(502, f"Higgsfield sedang bermasalah: {msg}")
    if isinstance(e, httpx.TimeoutException):
        return GenError(504, "Higgsfield tidak menjawab (waktu habis).")
    if isinstance(e, httpx.HTTPError):
        return GenError(502, "Tidak bisa terhubung ke Higgsfield. Periksa koneksi internet.")
    return GenError(502, f"Generate cloud gagal: {type(e).__name__}")


def submit(client: SyncClient, model: str, arguments: dict[str, Any], reference: Path | None = None, reference_key: str = "image_url") -> str:
    if not MODEL_RE.match(model) or ".." in model:
        raise GenError(400, "Model Higgsfield tidak valid.")
    args = dict(arguments)
    try:
        if reference is not None:
            args[reference_key] = client.upload_file(reference)
        return client.submit(model, arguments=args).request_id
    except Exception as e:  # noqa: BLE001 — semua error diterjemahkan ke pesan Bahasa Indonesia
        raise _translate(e) from None


def _find_url(data: Any) -> str | None:
    if isinstance(data, dict):
        for key in ("images", "image", "videos", "video", "output", "outputs", "result"):
            if key in data:
                u = _find_url(data[key])
                if u:
                    return u
        url = data.get("url")
        if isinstance(url, str) and url.startswith(("https://", "http://")):
            return url
        for v in data.values():
            u = _find_url(v)
            if u:
                return u
    if isinstance(data, list):
        for v in data:
            u = _find_url(v)
            if u:
                return u
    return None


def wait(client: SyncClient, request_id: str, timeout: float, poll_delay: float, transport: httpx.BaseTransport | None = None) -> Path:
    if not REQUEST_RE.match(request_id):
        raise GenError(400, "Id permintaan tidak valid.")
    ctl = client.get_request_controller(request_id)
    deadline = time.monotonic() + timeout
    try:
        while True:
            status = ctl.status()
            if isinstance(status, Completed):
                break
            if isinstance(status, NSFW):
                raise GenError(422, "Higgsfield menolak hasil ini karena filter konten (NSFW).")
            if isinstance(status, Cancelled):
                raise GenError(422, "Permintaan dibatalkan di Higgsfield.")
            if isinstance(status, Failed):
                raise GenError(422, "Higgsfield: generate gagal di server.")
            if time.monotonic() > deadline:
                raise GenError(504, "Generate cloud terlalu lama; akan dicek lagi.")
            time.sleep(poll_delay)
        data = client._transport.request("GET", ctl.response_url).json()
        url = _find_url(data)
        if not url:
            raise GenError(422, "Higgsfield selesai tapi tidak mengirim file hasil.")
        out = temp_dir()
        with httpx.Client(transport=transport, timeout=300, follow_redirects=True) as http:
            return download(http, url, out)
    except Exception as e:  # noqa: BLE001
        raise _translate(e) from None
