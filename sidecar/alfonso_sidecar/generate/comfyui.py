"""Jalur lokal lewat API HTTP ComfyUI yang dijalankan pengguna sendiri (spec 6). Hanya alamat 127.0.0.1/localhost."""

import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from . import GenError, download, temp_dir

TOKEN_RE = re.compile(r"\{\{([A-Z_]+)\}\}")
NUMERIC = {"SEED", "LEBAR", "TINGGI"}
PROMPT_ID_RE = re.compile(r"^[\w\-]{1,128}$")
OFFLINE = "ComfyUI tidak berjalan di {url}. Jalankan ComfyUI dulu, atau pindah ke jalur cloud."


def check_url(url: str) -> str:
    u = urlparse(url)
    ok = u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost") and u.path in ("", "/") and not u.query and not u.username
    if not ok:
        raise GenError(400, "Alamat ComfyUI harus http://127.0.0.1:<port> atau http://localhost:<port>.")
    return f"http://{u.hostname}:{u.port or 80}"


def _http(base: str, transport: httpx.BaseTransport | None, timeout: float = 30) -> httpx.Client:
    return httpx.Client(base_url=base, transport=transport, timeout=timeout, trust_env=False)


def is_running(url: str, transport: httpx.BaseTransport | None = None) -> bool:
    try:
        with _http(check_url(url), transport, timeout=3) as h:
            return h.get("/system_stats").status_code == 200
    except httpx.HTTPError:
        return False


def fill(node: Any, values: dict[str, Any]) -> Any:
    """Mengganti `{{NAMA}}` di semua string workflow. String yang isinya hanya penanda angka menjadi angka."""
    if isinstance(node, dict):
        return {k: fill(v, values) for k, v in node.items()}
    if isinstance(node, list):
        return [fill(v, values) for v in node]
    if isinstance(node, str):
        names = TOKEN_RE.findall(node)
        for n in names:
            if n not in values or values[n] is None:
                raise GenError(422, f"Workflow butuh nilai {{{{{n}}}}}, tapi tidak diisi.")
        whole = TOKEN_RE.fullmatch(node)
        if whole and whole.group(1) in NUMERIC:
            return int(values[whole.group(1)])
        return TOKEN_RE.sub(lambda m: str(values[m.group(1)]), node)
    return node


def load_workflow(path: Path) -> dict[str, Any]:
    try:
        wf = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise GenError(422, "File workflow bukan JSON yang valid.") from None
    if not isinstance(wf, dict) or "nodes" in wf or not all(isinstance(v, dict) and "class_type" in v for v in wf.values()):
        raise GenError(422, "Workflow harus diekspor dari ComfyUI dengan menu 'Export (API)'.")
    return wf


def submit(url: str, workflow: Path, values: dict[str, Any], reference: Path | None, transport: httpx.BaseTransport | None = None) -> str:
    base = check_url(url)
    wf = load_workflow(workflow)
    vals = dict(values)
    try:
        with _http(base, transport) as h:
            try:
                h.get("/system_stats", timeout=3).raise_for_status()
            except httpx.HTTPError:
                raise GenError(424, OFFLINE.format(url=base)) from None
            if reference is not None:
                with open(reference, "rb") as f:
                    r = h.post("/upload/image", files={"image": (reference.name, f, "application/octet-stream")}, data={"overwrite": "true"})
                r.raise_for_status()
                vals["GAMBAR"] = r.json()["name"]
            r = h.post("/prompt", json={"prompt": fill(wf, vals), "client_id": "alfonso"})
            if r.status_code >= 400:
                try:
                    body = r.json()
                    msg = (body.get("error") or {}).get("message") or str(body)[:300]
                except ValueError:
                    msg = r.text[:300]
                raise GenError(422 if r.status_code < 500 else 502, f"ComfyUI menolak workflow: {msg}")
            return str(r.json()["prompt_id"])
    except GenError:
        raise
    except httpx.TimeoutException:
        raise GenError(504, "ComfyUI tidak menjawab (waktu habis).") from None
    except (httpx.HTTPError, KeyError, ValueError):
        raise GenError(502, "Komunikasi dengan ComfyUI gagal.") from None


def _first_output(outputs: dict[str, Any]) -> dict[str, Any] | None:
    items = [it for node in outputs.values() if isinstance(node, dict) for key in ("images", "gifs", "videos") for it in node.get(key, []) if isinstance(it, dict)]
    preferred = [it for it in items if it.get("type") == "output"]
    return (preferred or items or [None])[0]


def wait(url: str, prompt_id: str, timeout: float, poll_delay: float, transport: httpx.BaseTransport | None = None) -> Path:
    base = check_url(url)
    if not PROMPT_ID_RE.match(prompt_id):
        raise GenError(400, "Id permintaan tidak valid.")
    deadline = time.monotonic() + timeout
    try:
        with _http(base, transport, timeout=300) as h:
            while True:
                try:
                    entry = h.get(f"/history/{prompt_id}").json().get(prompt_id)
                except httpx.ConnectError:
                    raise GenError(424, OFFLINE.format(url=base)) from None
                if entry:
                    if (entry.get("status") or {}).get("status_str") == "error":
                        raise GenError(422, "ComfyUI gagal menjalankan workflow (lihat jendela ComfyUI).")
                    item = _first_output(entry.get("outputs") or {})
                    if item is None:
                        raise GenError(422, "Workflow selesai tanpa gambar hasil (tambahkan node SaveImage).")
                    params = {"filename": item["filename"], "subfolder": item.get("subfolder", ""), "type": item.get("type", "output")}
                    return download(h, "/view", temp_dir(), stem=Path(item["filename"]).stem, params=params)
                if time.monotonic() > deadline:
                    raise GenError(504, "ComfyUI terlalu lama; akan dicek lagi.")
                time.sleep(poll_delay)
    except GenError:
        raise
    except httpx.TimeoutException:
        raise GenError(504, "ComfyUI tidak menjawab (waktu habis).") from None
    except (httpx.HTTPError, KeyError, ValueError):
        raise GenError(502, "Komunikasi dengan ComfyUI gagal.") from None
