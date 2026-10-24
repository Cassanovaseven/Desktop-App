import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from alfonso_sidecar.app import create_app

TOKEN = "t0k3n"
KEY = "kunci-uji:rahasia-uji"
BASE = "https://hf.test"


class FakeHiggsfield:
    """Server Higgsfield tiruan: mencatat permintaan, bisa diatur sukses / gagal / lambat."""

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.submit_status = 200
        self.final = "completed"
        self.pending_polls = 1
        self.polls = 0
        self.png = _png()

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.calls.append((req.method, req.url.path))
        if req.url.host == "cdn.test":
            return httpx.Response(200, content=self.png, headers={"content-type": "image/png"})
        if req.url.host == "upload.test":
            return httpx.Response(200)
        assert req.headers["authorization"] == f"Key {KEY}"
        if req.url.path == "/files/generate-upload-url":
            return httpx.Response(200, json={"public_url": "https://cdn.test/ref.png", "upload_url": "https://upload.test/put"})
        if req.method == "POST" and req.url.path.startswith("/bytedance"):
            self.body = json.loads(req.content)
            if self.submit_status != 200:
                return httpx.Response(self.submit_status, json={"detail": "ditolak server"})
            return httpx.Response(200, json={"request_id": "req-1", "status_url": f"{BASE}/requests/req-1/status", "cancel_url": f"{BASE}/requests/req-1/cancel"})
        if req.url.path == "/requests/req-1/status":
            self.polls += 1
            if self.polls <= self.pending_polls:
                return httpx.Response(200, json={"status": "in_progress"})
            if self.final == "completed":
                return httpx.Response(200, json={"status": "completed", "images": [{"url": "https://cdn.test/out/hasil.png"}]})
            return httpx.Response(200, json={"status": self.final})
        return httpx.Response(404, json={"detail": "tidak ada"})


def _png() -> bytes:
    import io

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (10, 20, 30)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def fake():
    return FakeHiggsfield()


@pytest.fixture
def client(vault: Path, fake: FakeHiggsfield):
    app = create_app(TOKEN, vault_root=str(vault), higgsfield_url=BASE, http_transport=httpx.MockTransport(fake), poll_delay=0)
    return TestClient(app)


H = {"X-Alfonso-Token": TOKEN, "X-Alfonso-Key": KEY}
MODEL = "bytedance/seedream/v4/text-to-image"


def test_submit_lalu_wait_mengunduh_hasil_ke_folder_sementara(client, fake):
    r = client.post("/generate/higgsfield/submit", headers=H, json={"model": MODEL, "arguments": {"prompt": "kucing", "aspect_ratio": "1:1"}})
    assert r.status_code == 200, r.text
    assert r.json() == {"request_id": "req-1"}
    assert fake.body == {"prompt": "kucing", "aspect_ratio": "1:1"}
    r = client.post("/generate/higgsfield/wait", headers=H, json={"request_id": "req-1"})
    assert r.status_code == 200, r.text
    out = r.json()
    p = Path(out["path"])
    assert p.read_bytes() == fake.png and out["ext"] == "png"
    assert Path(out["temp_dir"]).name.startswith("alfonso-gen-") and p.parent == Path(out["temp_dir"])
    # 2 cek status + 1 ambil hasil (di API Higgsfield, URL hasil = URL status).
    assert fake.polls == 3
    import shutil

    shutil.rmtree(out["temp_dir"])
    assert KEY not in r.text


def test_wait_dengan_id_lama_tidak_submit_ulang(client, fake):
    r = client.post("/generate/higgsfield/wait", headers=H, json={"request_id": "req-1"})
    assert r.status_code == 200
    assert not any(m == "POST" for m, _ in fake.calls)


def test_referensi_diunggah_dan_url_dikirim(client, fake, make):
    rel = make("png")
    r = client.post("/generate/higgsfield/submit", headers=H, json={"model": MODEL, "arguments": {"prompt": "x"}, "reference_path": rel, "reference_key": "image_url"})
    assert r.status_code == 200, r.text
    assert fake.body["image_url"] == "https://cdn.test/ref.png"
    assert ("POST", "/files/generate-upload-url") in fake.calls


def test_referensi_di_luar_vault_ditolak(client):
    r = client.post("/generate/higgsfield/submit", headers=H, json={"model": MODEL, "arguments": {}, "reference_path": "../rahasia.png"})
    assert r.status_code == 400


def test_kunci_ditolak_403(client, fake):
    fake.submit_status = 401
    r = client.post("/generate/higgsfield/submit", headers=H, json={"model": MODEL, "arguments": {"prompt": "x"}})
    assert r.status_code == 403 and "ditolak" in r.json()["detail"]


def test_server_error_sementara_502_tanpa_retry_internal(client, fake):
    fake.submit_status = 503
    r = client.post("/generate/higgsfield/submit", headers=H, json={"model": MODEL, "arguments": {"prompt": "x"}})
    assert r.status_code == 502
    assert sum(1 for m, p in fake.calls if m == "POST") == 1


def test_parameter_salah_422_permanen(client, fake):
    fake.submit_status = 422
    r = client.post("/generate/higgsfield/submit", headers=H, json={"model": MODEL, "arguments": {"prompt": "x"}})
    assert r.status_code == 422 and "ditolak server" in r.json()["detail"]


@pytest.mark.parametrize("final,pesan", [("nsfw", "konten"), ("failed", "gagal"), ("canceled", "dibatalkan")])
def test_status_akhir_buruk_422(client, fake, final, pesan):
    fake.final = final
    r = client.post("/generate/higgsfield/wait", headers=H, json={"request_id": "req-1"})
    assert r.status_code == 422 and pesan in r.json()["detail"]


def test_lambat_batas_waktu_504(vault, fake):
    fake.pending_polls = 10**6
    app = create_app(TOKEN, vault_root=str(vault), higgsfield_url=BASE, http_transport=httpx.MockTransport(fake), poll_delay=0, wait_timeout=0.05)
    r = TestClient(app).post("/generate/higgsfield/wait", headers=H, json={"request_id": "req-1"})
    assert r.status_code == 504


def test_tanpa_kunci_400_dan_token_tetap_wajib(client):
    assert client.post("/generate/higgsfield/submit", headers={"X-Alfonso-Token": TOKEN}, json={"model": MODEL, "arguments": {}}).status_code == 400
    assert client.post("/generate/higgsfield/submit", headers={"X-Alfonso-Key": KEY}, json={"model": MODEL, "arguments": {}}).status_code == 401


def test_model_aneh_ditolak(client):
    for m in ["../x", "https://evil.test/x", ""]:
        assert client.post("/generate/higgsfield/submit", headers=H, json={"model": m, "arguments": {}}).status_code == 400
