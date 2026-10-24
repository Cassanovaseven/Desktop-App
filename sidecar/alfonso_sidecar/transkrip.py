"""Transkrip lokal dengan faster-whisper. Model diunduh hanya lewat download_model(), setelah pengguna setuju."""

import logging
import os
import site
import sys
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


def add_cuda_dll_dirs(site_dirs=None, platform=sys.platform, add=None) -> list[str]:
    """Windows: daftarkan folder DLL paket pip nvidia-* (cuBLAS, cuDNN, NVRTC) sebelum ctranslate2 dimuat.
    cudnn64_9.dll bawaan ctranslate2 memuat sub-library cuDNN lewat PATH, jadi PATH juga diisi."""
    if platform != "win32":
        return []
    if site_dirs is None:
        site_dirs = site.getsitepackages()
    if add is None:
        add = os.add_dll_directory
    dirs = sorted(str(b) for d in site_dirs for b in Path(d).glob("nvidia/*/bin") if b.is_dir())
    for d in dirs:
        try:
            add(d)
        except OSError:
            pass
    if dirs:
        os.environ["PATH"] = os.pathsep.join(dirs + [os.environ.get("PATH", "")])
    return dirs


def load_model(path: str, gpu: bool = True):
    from faster_whisper import WhisperModel

    # GPU dipakai bila tersedia; kalau gagal (cuDNN/cuBLAS tidak ada), kembali ke CPU int8.
    if gpu:
        try:
            add_cuda_dll_dirs()
            import ctranslate2

            if ctranslate2.get_cuda_device_count() > 0:
                model = WhisperModel(path, device="cuda", compute_type="float16")
                model.on_gpu = True
                log.info("Transkrip memakai GPU (CUDA)")
                return model
        except Exception as e:
            log.warning("GPU tidak dipakai untuk transkrip: %s", type(e).__name__)
    # Bawaan CTranslate2 hanya 4 thread; di CPU, semua inti dipakai.
    log.info("Transkrip memakai CPU")
    return WhisperModel(path, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)


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


def _run(model, audio_data):
    # beam_size=1 (greedy): 2–3x lebih cepat dari bawaan 5, ketepatan turun sedikit.
    segments, info = model.transcribe(audio_data, vad_filter=True, beam_size=1)
    return [s.text.strip() for s in segments], info


def transcribe(models_root: Path, name: str, audio: Path) -> dict:
    if not is_ready(models_root, name):
        raise ModelMissing(name)
    audio_data = decode_audio(audio)
    if audio_data.size == 0:
        return {"text": "", "bahasa": None, "durasi": 0.0, "segmen": 0}
    # Satu transkrip sekaligus: model besar dan CPU/GPU dipakai penuh.
    with _run_lock:
        path = str(model_dir(models_root, name))
        model = _models.get(name)
        if model is None:
            model = _models[name] = load_model(path)
        try:
            parts, info = _run(model, audio_data)
        except Exception as e:
            # cuDNN/cuBLAS baru dimuat saat transkrip pertama; kalau GPU gagal di sini, pindah ke CPU.
            if not getattr(model, "on_gpu", False):
                raise TranscribeError(type(e).__name__) from e
            log.warning("GPU gagal saat transkrip (%s), pindah ke CPU", type(e).__name__)
            model = _models[name] = load_model(path, gpu=False)
            try:
                parts, info = _run(model, audio_data)
            except Exception as e2:
                raise TranscribeError(type(e2).__name__) from e2
    return {
        "text": "\n".join(p for p in parts if p),
        "bahasa": getattr(info, "language", None),
        "durasi": round(float(getattr(info, "duration", 0) or 0), 2),
        "segmen": len(parts),
    }
