from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from alfonso_sidecar import transkrip
from alfonso_sidecar.app import create_app

TOKEN = "t0k3n"
H = {"X-Alfonso-Token": TOKEN}
# Disimpan sebelum fixture menggantinya dengan FakeModel.
REAL_LOAD_MODEL = transkrip.load_model


@pytest.fixture
def models(tmp_path: Path) -> Path:
    return tmp_path / "models"


@pytest.fixture
def client(vault: Path, models: Path) -> TestClient:
    return TestClient(create_app(TOKEN, vault_root=str(vault), models_root=str(models)))


class FakeModel:
    def __init__(self, path):
        self.path = path

    def transcribe(self, audio, **kw):
        assert kw.get("vad_filter") is True
        segs = (SimpleNamespace(text=t) for t in (" Selamat pagi ", " rapat dimulai "))
        return segs, SimpleNamespace(language="id", duration=2.0)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    # Tes tidak pernah mengunduh model sungguhan.
    def fake_fetch(name, output_dir):
        (Path(output_dir) / "model.bin").write_bytes(b"palsu")

    monkeypatch.setattr(transkrip, "fetch_model", fake_fetch)
    monkeypatch.setattr(transkrip, "load_model", FakeModel)
    transkrip._models.clear()


def test_status_model_belum_ada(client):
    r = client.get("/models/whisper", headers=H)
    assert r.status_code == 200
    assert r.json() == {"model": "small", "siap": False, "pilihan": {"small": 480, "large-v3-turbo": 1600}}


def test_transkrip_tanpa_model_409(client, make):
    r = client.post("/transcribe", headers=H, json={"path": make("wav"), "asset_id": "a1"})
    assert r.status_code == 409 and r.json()["detail"] == "Model transkrip belum diunduh"


def test_unduh_lalu_transkrip(client, make, models):
    r = client.post("/models/whisper/download", headers=H, json={"model": "small"})
    assert r.status_code == 200 and (models / "whisper-small" / "model.bin").is_file()
    assert client.get("/models/whisper", headers=H).json()["siap"] is True
    j = client.post("/transcribe", headers=H, json={"path": make("wav"), "asset_id": "a1"}).json()
    assert j == {"text": "Selamat pagi\nrapat dimulai", "bahasa": "id", "durasi": 2.0, "segmen": 2}


def test_model_tidak_dikenal_ditolak(client):
    r = client.post("/models/whisper/download", headers=H, json={"model": "../../etc"})
    assert r.status_code == 400


def test_transkrip_path_di_luar_files_ditolak(client):
    r = client.post("/transcribe", headers=H, json={"path": "../rahasia.wav", "asset_id": "a1"})
    assert r.status_code == 400


def test_transkrip_gagal_422(client, make, monkeypatch):
    class Rusak(FakeModel):
        def transcribe(self, audio, **kw):
            raise RuntimeError("decode")

    monkeypatch.setattr(transkrip, "load_model", Rusak)
    client.post("/models/whisper/download", headers=H, json={"model": "small"})
    r = client.post("/transcribe", headers=H, json={"path": make("wav"), "asset_id": "a1"})
    assert r.status_code == 422 and r.json()["detail"] == "Transkrip gagal"


def test_tanpa_folder_model_503(vault, make):
    c = TestClient(create_app(TOKEN, vault_root=str(vault)))
    assert c.get("/models/whisper", headers=H).status_code == 503


def test_decode_audio_16khz_mono_tanpa_model(make, vault):
    # faster-whisper 1.2.1 decode_audio tidak cocok dengan PyAV 19, jadi audio didecode sendiri.
    audio = transkrip.decode_audio(vault / make("wav"))
    assert audio.dtype.name == "float32" and audio.ndim == 1
    assert abs(len(audio) - 32000) < 400
    assert 0.1 < float(abs(audio).max()) <= 1.0


def test_video_tanpa_suara_transkrip_kosong(client, make):
    client.post("/models/whisper/download", headers=H, json={"model": "small"})
    j = client.post("/transcribe", headers=H, json={"path": make("mp4"), "asset_id": "a1"}).json()
    assert j["text"] == "" and j["segmen"] == 0


def test_model_menerima_array_bukan_path(client, make, monkeypatch):
    seen = {}

    class Cek(FakeModel):
        def transcribe(self, audio, **kw):
            seen["type"] = type(audio).__name__
            return super().transcribe(audio, **kw)

    monkeypatch.setattr(transkrip, "load_model", Cek)
    client.post("/models/whisper/download", headers=H, json={"model": "small"})
    client.post("/transcribe", headers=H, json={"path": make("wav"), "asset_id": "a1"})
    assert seen["type"] == "ndarray"


def test_transkrip_memakai_greedy_supaya_cepat(client, make, monkeypatch):
    seen = {}

    class Cek(FakeModel):
        def transcribe(self, audio, **kw):
            seen.update(kw)
            return super().transcribe(audio, **kw)

    monkeypatch.setattr(transkrip, "load_model", Cek)
    client.post("/models/whisper/download", headers=H, json={"model": "small"})
    client.post("/transcribe", headers=H, json={"path": make("wav"), "asset_id": "a1"})
    assert seen["beam_size"] == 1


def test_model_cpu_memakai_semua_inti(monkeypatch):
    import sys
    import types

    made = {}

    class FakeWhisper:
        def __init__(self, path, **kw):
            made.update(kw)

    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=FakeWhisper))
    monkeypatch.setitem(sys.modules, "ctranslate2", types.SimpleNamespace(get_cuda_device_count=lambda: 0))
    monkeypatch.setattr(transkrip.os, "cpu_count", lambda: 12)
    REAL_LOAD_MODEL("x")
    assert made == {"device": "cpu", "compute_type": "int8", "cpu_threads": 12}
