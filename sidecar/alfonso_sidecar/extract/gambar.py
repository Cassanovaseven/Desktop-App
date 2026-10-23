import logging
import threading
from pathlib import Path

from PIL import Image, UnidentifiedImageError

# PSD dibaca lewat gambar gabungannya (lapisan atas yang sudah digabung), tanpa psd-tools.
RASTER = {"png", "jpg", "jpeg", "webp", "gif", "psd"}
THUMB_SIZE = (512, 512)
OCR_MAX_SIDE = 2000

log = logging.getLogger("alfonso_sidecar")


class ImageError(Exception):
    pass


_ocr = None
_ocr_lock = threading.Lock()


def _engine():
    # Model OCR ikut paket rapidocr; dimuat sekali saja (beberapa detik) saat pertama dipakai.
    global _ocr
    with _ocr_lock:
        if _ocr is None:
            from rapidocr import RapidOCR

            _ocr = RapidOCR()
            logging.getLogger("RapidOCR").setLevel(logging.WARNING)
        return _ocr


def ocr_text(img: Image.Image) -> str:
    small = img.copy()
    small.thumbnail((OCR_MAX_SIDE, OCR_MAX_SIDE))
    out = _engine()(small)
    return "\n".join(t.strip() for t in (out.txts or ()) if t.strip())


def dominant_color(rgb: Image.Image) -> str:
    small = rgb.copy()
    small.thumbnail((64, 64))
    q = small.quantize(colors=5)
    count, idx = max(q.getcolors())
    r, g, b = q.getpalette()[idx * 3 : idx * 3 + 3]
    return f"#{r:02x}{g:02x}{b:02x}"


def image(path: Path, thumb_path: Path):
    try:
        with Image.open(path) as img:
            width, height = img.size
            frames = getattr(img, "n_frames", 1)
            # Untuk GIF, Image.open berada di frame pertama.
            rgb = img.convert("RGB")
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as e:
        raise ImageError(str(e)) from e
    thumb = rgb.copy()
    thumb.thumbnail(THUMB_SIZE)
    # Nama thumbnail = id asset; file baru di thumbs/, file asli tidak disentuh.
    thumb.save(thumb_path, "WEBP")
    meta = {"lebar": width, "tinggi": height, "warna": dominant_color(rgb)}
    if frames > 1:
        meta["frame"] = frames
    try:
        text = ocr_text(rgb)
        meta["ocr"] = "ok"
    except Exception as e:  # OCR gagal tidak menggagalkan thumbnail dan metadata
        log.warning("OCR gagal: %s", type(e).__name__)
        text = ""
        meta["ocr"] = "gagal"
    return text, meta, thumb_path
