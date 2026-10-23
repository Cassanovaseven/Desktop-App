"""Transkrip lokal dengan faster-whisper. Model diunduh hanya lewat download_model(), setelah pengguna setuju."""

import logging
import threading
from pathlib import Path

log = logging.getLogger("alfonso_sidecar")

# Nama yang boleh dipakai → perkiraan ukuran unduhan (MB), untuk dialog konfirmasi.
MODELS = {"small": 480, "large-v3-turbo": 1600}
DEFAULT_MODEL = "small"


class ModelMissing(Exception):
    pass


class TranscribeError(Exception):
    pass


def model_dir(models_root: Path, name: str) -> Path:
    if name not in MODELS:
        raise ValueError(name)
    return models_root / f"whisper-{name}"


def is_ready(models_root: Path, name: str) -> bool:
    return (model_dir(models_root, name) / "model.bin").is_file()


def fetch_model(name: str, output_dir: str) -> None:
    from faster_whisper.utils import download_model

    download_model(name, output_dir=output_dir)


_download_lock = threading.Lock()


def download(models_root: Path, name: str) -> Path:
    target = model_dir(models_root, name)
    with _download_lock:
        if not is_ready(models_root, name):
            target.mkdir(parents=True, exist_ok=True)
            fetch_model(name, str(target))
    if not is_ready(models_root, name):
        raise TranscribeError("Unduhan model tidak lengkap")
    return target


def load_model(path: str):
    from faster_whisper import WhisperModel

    # GPU dipakai bila tersedia; kalau gagal (cuDNN/cuBLAS tidak ada), kembali ke CPU int8.
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return WhisperModel(path, device="cuda", compute_type="float16")
    except Exception as e:
        log.warning("GPU tidak dipakai untuk transkrip: %s", type(e).__name__)
    return WhisperModel(path, device="cpu", compute_type="int8")


SAMPLE_RATE = 16000


def decode_audio(path: Path):
    """Audio → float32 mono 16 kHz. Pengganti faster_whisper.decode_audio, yang memakai argumen
    av.open yang sudah dihapus di PyAV 19. Mengembalikan array kosong bila file tidak punya suara."""
    import av
    import numpy as np

    chunks = []
    try:
        with av.open(str(path)) as c:
            if not c.streams.audio:
                return np.zeros(0, dtype=np.float32)
            resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
            for frame in c.decode(audio=0):
                for out in resampler.resample(frame):
                    chunks.append(out.to_ndarray().reshape(-1))
            for out in resampler.resample(None):
                chunks.append(out.to_ndarray().reshape(-1))
    except (av.FFmpegError, OSError, ValueError) as e:
        raise TranscribeError(type(e).__name__) from e
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return (np.concatenate(chunks).astype(np.float32) / 32768.0).astype(np.float32)


_models: dict[str, object] = {}
_run_lock = threading.Lock()


def transcribe(models_root: Path, name: str, audio: Path) -> dict:
    if not is_ready(models_root, name):
        raise ModelMissing(name)
    audio_data = decode_audio(audio)
    if audio_data.size == 0:
        return {"text": "", "bahasa": None, "durasi": 0.0, "segmen": 0}
    # Satu transkrip sekaligus: model besar dan CPU/GPU dipakai penuh.
    with _run_lock:
        model = _models.get(name)
        if model is None:
            model = _models[name] = load_model(str(model_dir(models_root, name)))
        try:
            segments, info = model.transcribe(audio_data, vad_filter=True)
            parts = [s.text.strip() for s in segments]
        except Exception as e:
            raise TranscribeError(type(e).__name__) from e
    return {
        "text": "\n".join(p for p in parts if p),
        "bahasa": getattr(info, "language", None),
        "durasi": round(float(getattr(info, "duration", 0) or 0), 2),
        "segmen": len(parts),
    }
