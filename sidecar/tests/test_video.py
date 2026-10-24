import shutil
import tempfile
from pathlib import Path

import av
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from alfonso_sidecar.app import create_app

TOKEN = "t0k3n"
H = {"X-Alfonso-Token": TOKEN}


@pytest.fixture
def frames():
    d = Path(tempfile.mkdtemp(prefix="alfonso-frames-"))
    yield d
    shutil.rmtree(d, ignore_errors=True)


def put(d: Path, n: int, size=(65, 49)):
    for i in range(n):
        Image.new("RGB", size, (i * 8 % 255, 100, 200)).save(d / f"{i:05d}.png")


@pytest.fixture
def client(vault):
    return TestClient(create_app(TOKEN, vault_root=str(vault)))


def test_30_frame_jadi_mp4_1_detik(client, frames):
    put(frames, 30)
    r = client.post("/encode/video", headers=H, json={"frames_dir": str(frames), "fps": 30})
    assert r.status_code == 200, r.text
    out = Path(r.json()["path"])
    assert out.suffix == ".mp4" and Path(r.json()["temp_dir"]).name.startswith("alfonso-gen-")
    with av.open(str(out)) as c:
        s = c.streams.video[0]
        n = sum(1 for _ in c.decode(s))
        assert n == 30
        # Ukuran ganjil dibulatkan ke genap (syarat yuv420p).
        assert (s.codec_context.width, s.codec_context.height) == (64, 48)
        assert abs(float(c.duration / av.time_base) - 1.0) < 0.1
    shutil.rmtree(out.parent)


def test_ukuran_frame_berbeda_ditolak(client, frames):
    put(frames, 2)
    Image.new("RGB", (10, 10)).save(frames / "00002.png")
    r = client.post("/encode/video", headers=H, json={"frames_dir": str(frames), "fps": 24})
    assert r.status_code == 422


def test_folder_bukan_milik_alfonso_ditolak(client, tmp_path):
    put(tmp_path, 2)
    assert client.post("/encode/video", headers=H, json={"frames_dir": str(tmp_path), "fps": 24}).status_code == 400


def test_batas_fps_dan_jumlah_frame(client, frames):
    put(frames, 2)
    assert client.post("/encode/video", headers=H, json={"frames_dir": str(frames), "fps": 120}).status_code == 400
    assert client.post("/encode/video", headers=H, json={"frames_dir": str(frames), "fps": 24, "max_frames": 1}).status_code == 422


def test_folder_kosong_ditolak(client, frames):
    assert client.post("/encode/video", headers=H, json={"frames_dir": str(frames), "fps": 24}).status_code == 422


def test_ekstrak_hasil_generate_di_folder_generated(client, vault):
    (vault / "generated" / "2026-10").mkdir(parents=True)
    Image.new("RGB", (40, 30), (200, 10, 10)).save(vault / "generated" / "2026-10" / "x.png")
    r = client.post("/extract", headers=H, json={"path": "generated/2026-10/x.png", "asset_id": "a1"})
    assert r.status_code == 200, r.text
    (vault / "logs").mkdir()
    (vault / "logs" / "x.png").write_bytes(b"x")
    assert client.post("/extract", headers=H, json={"path": "logs/x.png", "asset_id": "a1"}).status_code == 400
