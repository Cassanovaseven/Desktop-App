"""Audio dan video lewat PyAV (FFmpeg ikut di dalam wheel, tanpa ffmpeg sistem)."""

from pathlib import Path

import av

AUDIO = {"mp3", "wav", "m4a", "ogg"}
VIDEO = {"mp4", "mov", "mkv", "webm"}
THUMB_SIZE = (512, 512)


class MediaError(Exception):
    pass


def _duration(container) -> float | None:
    if container.duration is not None:
        return round(container.duration / av.time_base, 2)
    for s in container.streams:
        if s.duration is not None and s.time_base is not None:
            return round(float(s.duration * s.time_base), 2)
    return None


def media(path: Path, thumb_path: Path, is_video: bool):
    try:
        with av.open(str(path)) as c:
            meta: dict = {"durasi": _duration(c), "transkrip": "belum"}
            if not c.streams.audio and not c.streams.video:
                raise MediaError("tidak ada aliran audio/video")
            if not is_video or not c.streams.video:
                return "", meta, None
            stream = c.streams.video[0]
            meta["lebar"], meta["tinggi"] = stream.codec_context.width, stream.codec_context.height
            # Frame kunci: sekitar 10% durasi (maks. 10 detik), supaya tidak dapat layar hitam di awal.
            target = min((meta["durasi"] or 0) * 0.1, 10.0)
            if target > 0:
                c.seek(int(target / stream.time_base), stream=stream, any_frame=False, backward=True)
            frame = next(c.decode(stream), None)
            if frame is None:
                raise MediaError("tidak ada frame")
            img = frame.to_image()
    except MediaError:
        raise
    except (av.FFmpegError, OSError, StopIteration, ValueError) as e:
        raise MediaError(str(e)) from e
    img.thumbnail(THUMB_SIZE)
    img.save(thumb_path, "WEBP")
    return "", meta, thumb_path
