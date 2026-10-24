"""Merakit frame PNG dari jalur kode (p5 motion) menjadi MP4 H.264 dengan PyAV."""

import tempfile
from pathlib import Path

import av
from PIL import Image

from . import GenError, temp_dir

FPS = (12, 24, 25, 30, 60)
MAX_FRAMES = 60 * 30


def own_frames_dir(path: str) -> Path:
    d = Path(path).resolve()
    if d.parent != Path(tempfile.gettempdir()).resolve() or not d.name.startswith("alfonso-frames-") or not d.is_dir():
        raise GenError(400, "Folder frame tidak diizinkan.")
    return d


def encode(frames_dir: str, fps: int, max_frames: int = MAX_FRAMES) -> Path:
    if fps not in FPS:
        raise GenError(400, "fps tidak didukung.")
    d = own_frames_dir(frames_dir)
    files = sorted(p for p in d.iterdir() if p.suffix.lower() == ".png")
    if not files:
        raise GenError(422, "Tidak ada frame untuk dirakit.")
    if len(files) > max_frames:
        raise GenError(422, f"Terlalu banyak frame (maks. {max_frames}).")
    with Image.open(files[0]) as first:
        size = first.size
    # yuv420p butuh lebar/tinggi genap.
    w, h = size[0] - size[0] % 2, size[1] - size[1] % 2
    if w < 2 or h < 2:
        raise GenError(422, "Frame terlalu kecil.")
    out = temp_dir() / "hasil.mp4"
    try:
        with av.open(str(out), "w") as c:
            s = c.add_stream("libx264", rate=fps)
            s.width, s.height, s.pix_fmt = w, h, "yuv420p"
            s.options = {"crf": "18", "preset": "medium"}
            for f in files:
                with Image.open(f) as img:
                    if img.size != size:
                        raise GenError(422, "Semua frame harus berukuran sama.")
                    frame = av.VideoFrame.from_image(img.convert("RGB").crop((0, 0, w, h)))
                for packet in s.encode(frame):
                    c.mux(packet)
            for packet in s.encode():
                c.mux(packet)
    except GenError:
        out.unlink(missing_ok=True)
        out.parent.rmdir()
        raise
    return out
