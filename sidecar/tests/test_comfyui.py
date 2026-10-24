import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from alfonso_sidecar.app import create_app

TOKEN = "t0k3n"
H = {"X-Alfonso-Token": TOKEN}
URL = "http://127.0.0.1:8188"

WORKFLOW = {
    "3": {"class_type": "KSampler", "inputs": {"seed": "{{SEED}}", "steps": 20, "model": ["4", 0]}},
    "5": {"class_type": "EmptyLatentImage", "inputs": {"width": "{{LEBAR}}", "height": "{{TINGGI}}", "batch_size": 1}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{PROMPT}}, high detail"}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{NEGATIF}}"}},
    "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "alfonso", "images": ["8", 0]}},
}


class FakeComfy:
    def __init__(self):
        self.alive = True
        self.prompt_status = 200
        self.history_polls = 1
        self.polls = 0
        self.error = False
        self.sent = None
        self.uploads = 0

    def __call__(self, req: httpx.Request) -> httpx.Response:
        if not self.alive:
            raise httpx.ConnectError("refused", request=req)
        p = req.url.path
        if p == "/system_stats":
            return httpx.Response(200, json={"system": {}})
        if p == "/upload/image":
            self.uploads += 1
            return httpx.Response(200, json={"name": "ref.png", "subfolder": "", "type": "input"})
        if p == "/prompt":
            self.sent = json.loads(req.content)
            if self.prompt_status != 200:
                return httpx.Response(400, json={"error": {"message": "Prompt outputs failed validation"}, "node_errors": {}})
            return httpx.Response(200, json={"prompt_id": "pid-1", "number": 1})
        if p == "/history/pid-1":
            self.polls += 1
            if self.polls <= self.history_polls:
                return httpx.Response(200, json={})
            if self.error:
                return httpx.Response(200, json={"pid-1": {"status": {"status_str": "error", "completed": False}, "outputs": {}}})
            return httpx.Response(200, json={"pid-1": {"status": {"status_str": "success", "completed": True}, "outputs": {
                "9": {"images": [{"filename": "alfonso_00001_.png", "subfolder": "", "type": "output"}]}}}})
        if p == "/view":
            assert req.url.params["filename"] == "alfonso_00001_.png" and req.url.params["type"] == "output"
            return httpx.Response(200, content=b"\x89PNG-hasil", headers={"content-type": "image/png"})
        return httpx.Response(404)


@pytest.fixture
def fake():
    return FakeComfy()


@pytest.fixture
def wf(vault: Path) -> str:
    (vault / "files" / "ab" / "wf.json").write_text(json.dumps(WORKFLOW), encoding="utf-8")
    return "files/ab/wf.json"


@pytest.fixture
def client(vault, fake):
    return TestClient(create_app(TOKEN, vault_root=str(vault), http_transport=httpx.MockTransport(fake), poll_delay=0))


VALUES = {"PROMPT": "rumah kayu", "NEGATIF": "buram", "SEED": 42, "LEBAR": 768, "TINGGI": 512}


def test_penanda_diganti_dengan_tipe_yang_benar_lalu_hasil_diunduh(client, fake, wf):
    r = client.post("/generate/comfyui/submit", headers=H, json={"base_url": URL, "workflow_path": wf, "values": VALUES})
    assert r.status_code == 200, r.text
    assert r.json() == {"prompt_id": "pid-1"}
    sent = fake.sent["prompt"]
    assert sent["3"]["inputs"]["seed"] == 42
    assert sent["5"]["inputs"] == {"width": 768, "height": 512, "batch_size": 1}
    assert sent["6"]["inputs"]["text"] == "rumah kayu, high detail"
    assert sent["7"]["inputs"]["text"] == "buram"
    assert sent["3"]["inputs"]["model"] == ["4", 0]
    r = client.post("/generate/comfyui/wait", headers=H, json={"base_url": URL, "prompt_id": "pid-1"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert Path(out["path"]).read_bytes() == b"\x89PNG-hasil" and out["ext"] == "png"
    import shutil

    shutil.rmtree(out["temp_dir"])


def test_comfyui_mati_424(client, fake, wf):
    fake.alive = False
    r = client.post("/generate/comfyui/submit", headers=H, json={"base_url": URL, "workflow_path": wf, "values": VALUES})
    assert r.status_code == 424 and "ComfyUI tidak berjalan" in r.json()["detail"]
    r = client.get("/generate/comfyui/status", headers=H, params={"base_url": URL})
    assert r.status_code == 200 and r.json() == {"berjalan": False}


def test_status_hidup(client, wf):
    assert client.get("/generate/comfyui/status", headers=H, params={"base_url": URL}).json() == {"berjalan": True}


@pytest.mark.parametrize("url", ["http://192.168.1.5:8188", "https://example.com", "http://127.0.0.1:8188/../x", "file:///etc", "http://localhost.evil.test:8188"])
def test_alamat_selain_localhost_ditolak(client, wf, url):
    r = client.post("/generate/comfyui/submit", headers=H, json={"base_url": url, "workflow_path": wf, "values": VALUES})
    assert r.status_code == 400


def test_localhost_diterima(client, wf):
    r = client.post("/generate/comfyui/submit", headers=H, json={"base_url": "http://localhost:8188", "workflow_path": wf, "values": VALUES})
    assert r.status_code == 200


def test_workflow_format_ui_ditolak_dengan_petunjuk(client, vault):
    (vault / "files" / "ab" / "ui.json").write_text(json.dumps({"nodes": [], "links": []}), encoding="utf-8")
    r = client.post("/generate/comfyui/submit", headers=H, json={"base_url": URL, "workflow_path": "files/ab/ui.json", "values": VALUES})
    assert r.status_code == 422 and "Export (API)" in r.json()["detail"]


def test_validasi_comfyui_gagal_422(client, fake, wf):
    fake.prompt_status = 400
    r = client.post("/generate/comfyui/submit", headers=H, json={"base_url": URL, "workflow_path": wf, "values": VALUES})
    assert r.status_code == 422 and "validation" in r.json()["detail"]


def test_error_saat_render_422(client, fake):
    fake.error = True
    r = client.post("/generate/comfyui/wait", headers=H, json={"base_url": URL, "prompt_id": "pid-1"})
    assert r.status_code == 422


def test_referensi_diunggah_dan_penanda_gambar_diisi(client, fake, vault, make):
    ref = make("png")
    wf = dict(WORKFLOW, **{"10": {"class_type": "LoadImage", "inputs": {"image": "{{GAMBAR}}"}}})
    (vault / "files" / "ab" / "wf2.json").write_text(json.dumps(wf), encoding="utf-8")
    r = client.post("/generate/comfyui/submit", headers=H, json={"base_url": URL, "workflow_path": "files/ab/wf2.json", "values": VALUES, "reference_path": ref})
    assert r.status_code == 200, r.text
    assert fake.uploads == 1 and fake.sent["prompt"]["10"]["inputs"]["image"] == "ref.png"


def test_penanda_tanpa_nilai_ditolak(client, vault):
    wf = {"10": {"class_type": "LoadImage", "inputs": {"image": "{{GAMBAR}}"}}}
    (vault / "files" / "ab" / "wf3.json").write_text(json.dumps(wf), encoding="utf-8")
    r = client.post("/generate/comfyui/submit", headers=H, json={"base_url": URL, "workflow_path": "files/ab/wf3.json", "values": VALUES})
    assert r.status_code == 422 and "GAMBAR" in r.json()["detail"]


def test_lambat_504(vault, fake, wf):
    fake.history_polls = 10**6
    app = create_app(TOKEN, vault_root=str(vault), http_transport=httpx.MockTransport(fake), poll_delay=0, wait_timeout=0.05)
    r = TestClient(app).post("/generate/comfyui/wait", headers=H, json={"base_url": URL, "prompt_id": "pid-1"})
    assert r.status_code == 504
