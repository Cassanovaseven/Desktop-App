import hashlib
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from alfonso_sidecar.app import create_app

TOKEN = "t0k3n"
H = {"X-Alfonso-Token": TOKEN}


@pytest.fixture
def client(vault: Path) -> TestClient:
    return TestClient(create_app(TOKEN, vault_root=str(vault)))


def extract(client: TestClient, rel: str, asset_id: str = "aset1"):
    return client.post("/extract", headers=H, json={"path": rel, "asset_id": asset_id})


def test_pdf(client, make):
    r = extract(client, make("pdf"))
    assert r.status_code == 200 and "pidana" in r.json()["text"]


def test_pdf_rusak_422(client, make):
    r = extract(client, make("pdf-rusak"))
    assert r.status_code == 422 and r.json()["detail"] == "PDF rusak atau terenkripsi"


def test_docx_teks_dan_heading(client, make):
    j = extract(client, make("docx")).json()
    assert "riset hukum" in j["text"] and j["meta"]["heading"] == ["Bab Satu"]


def test_pptx(client, make):
    j = extract(client, make("pptx")).json()
    assert "Judul Slide" in j["text"] and "poin presentasi" in j["text"] and j["meta"]["slide"] == 1


def test_xlsx(client, make):
    j = extract(client, make("xlsx")).json()
    assert "anggaran" in j["text"] and "1200" in j["text"]


@pytest.mark.parametrize("kind,word", [("csv", "Bandung"), ("md", "kata kunci"), ("epub", "cerita panjang")])
def test_teks(client, make, kind, word):
    assert word in extract(client, make(kind)).json()["text"]


def test_html_tanpa_tag_dan_script(client, make):
    t = extract(client, make("html")).json()["text"]
    assert "halo" in t and "dunia" in t and "<" not in t and "x=1" not in t


def test_kode_dengan_bahasa(client, make):
    j = extract(client, make("py")).json()
    assert "def halo" in j["text"] and j["meta"]["bahasa"] == "python"


def test_gambar_thumbnail_dan_warna(client, make, vault):
    rel = make("png")
    before = hashlib.sha256((vault / rel).read_bytes()).hexdigest()
    j = extract(client, rel, "aset-gbr").json()
    assert j["thumb"] == "thumbs/aset-gbr.webp" and (vault / "thumbs" / "aset-gbr.webp").exists()
    assert j["meta"]["warna"].startswith("#") and len(j["meta"]["warna"]) == 7
    assert hashlib.sha256((vault / rel).read_bytes()).hexdigest() == before


def test_zip_entri_aman_saja(client, make):
    j = extract(client, make("zip")).json()
    names = sorted(e["name"] for e in j["meta"]["entri"])
    assert names == ["catatan.txt", "sub/gambar.md"]
    for e in j["meta"]["entri"]:
        assert Path(e["path"]).is_file() and Path(e["path"]).is_relative_to(j["meta"]["temp_dir"])
    assert j["meta"]["ditolak"] == 2
    shutil.rmtree(j["meta"]["temp_dir"])


def test_asset_id_tidak_valid_400(client, make):
    assert extract(client, make("png"), "../x").status_code == 400


def test_zip_bom_tidak_dibongkar(client, make):
    j = extract(client, make("zip-bom")).json()
    assert j["meta"]["entri"] == [] and "terlalu besar" in j["meta"]["catatan"]


def test_format_tak_dikenal(client, make):
    j = extract(client, make("bin")).json()
    assert j["text"] == "" and j["meta"]["ukuran"] == 3


def test_path_di_luar_vault_400(client, vault):
    (vault.parent / "rahasia.txt").write_text("x")
    for rel in ["../rahasia.txt", str(vault.parent / "rahasia.txt"), "alfonso.db", "logs/x.log"]:
        assert extract(client, rel).status_code == 400


def test_file_hilang_404(client):
    assert extract(client, "files/ab/hilang.pdf").status_code == 404


def test_extract_butuh_token(client, make):
    assert client.post("/extract", json={"path": make("md"), "asset_id": "a"}).status_code == 401


# ---- Fase 1B: OCR, warna dominan, GIF, PSD ----


def test_ocr_teks_di_gambar_masuk_teks(client, make):
    j = extract(client, make("png-teks"), "aset-ocr").json()
    assert "pidana" in j["text"].lower()
    assert j["meta"]["ocr"] == "ok"


def test_gambar_tanpa_teks_ocr_kosong(client, make):
    j = extract(client, make("png")).json()
    assert j["text"] == "" and j["meta"]["ocr"] == "ok"


def test_warna_dominan_bukan_rata_rata(client, make):
    j = extract(client, make("png-dominan")).json()
    r, g, b = (int(j["meta"]["warna"][i : i + 2], 16) for i in (1, 3, 5))
    assert r > 180 and g < 60 and b < 60


def test_gif_frame_pertama(client, make, vault):
    j = extract(client, make("gif"), "aset-gif").json()
    assert j["thumb"] == "thumbs/aset-gif.webp"
    with Image.open(vault / j["thumb"]) as t:
        r, g, b = t.convert("RGB").getpixel((5, 5))
    assert g > 150 and b < 60
    assert j["meta"]["frame"] == 2


def test_psd_gambar_gabungan(client, make, vault):
    rel = make("psd")
    before = hashlib.sha256((vault / rel).read_bytes()).hexdigest()
    j = extract(client, rel, "aset-psd").json()
    assert j["thumb"] == "thumbs/aset-psd.webp" and j["meta"]["lebar"] == 32 and j["meta"]["tinggi"] == 24
    assert j["meta"]["warna"] == "#0a78c8"
    assert hashlib.sha256((vault / rel).read_bytes()).hexdigest() == before


def test_psd_rusak_422(client, make):
    r = extract(client, make("psd-rusak"))
    assert r.status_code == 422 and r.json()["detail"] == "Gambar rusak atau formatnya tidak didukung"


def test_ocr_gagal_tidak_menggagalkan_ekstraksi(client, make, monkeypatch):
    from alfonso_sidecar.extract import gambar

    def boom(_img):
        raise RuntimeError("onnx mati")

    monkeypatch.setattr(gambar, "ocr_text", boom)
    j = extract(client, make("png")).json()
    assert j["meta"]["ocr"] == "gagal" and j["thumb"]


# ---- Fase 1B: audio dan video ----


def test_audio_durasi_tanpa_thumbnail(client, make):
    j = extract(client, make("wav")).json()
    assert abs(j["meta"]["durasi"] - 2.0) < 0.1
    assert j["thumb"] is None and j["text"] == ""


def test_video_durasi_dan_frame_kunci(client, make, vault):
    rel = make("mp4")
    before = hashlib.sha256((vault / rel).read_bytes()).hexdigest()
    j = extract(client, rel, "aset-vid").json()
    assert abs(j["meta"]["durasi"] - 2.0) < 0.3
    assert j["meta"]["lebar"] == 64 and j["meta"]["tinggi"] == 48
    assert j["thumb"] == "thumbs/aset-vid.webp"
    with Image.open(vault / j["thumb"]) as t:
        r, g, b = t.convert("RGB").getpixel((10, 10))
    assert g > 120 and r < 80
    assert hashlib.sha256((vault / rel).read_bytes()).hexdigest() == before


def test_video_rusak_422(client, make):
    r = extract(client, make("mp4-rusak"))
    assert r.status_code == 422 and r.json()["detail"] == "Audio/video rusak atau formatnya tidak didukung"
