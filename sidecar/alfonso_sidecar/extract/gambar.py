from pathlib import Path

from PIL import Image, UnidentifiedImageError

RASTER = {"png", "jpg", "jpeg", "webp", "gif"}
THUMB_SIZE = (512, 512)


class ImageError(Exception):
    pass


def image(path: Path, thumb_path: Path):
    try:
        with Image.open(path) as img:
            width, height = img.size
            rgb = img.convert("RGB")
    except (UnidentifiedImageError, OSError) as e:
        raise ImageError(str(e)) from e
    r, g, b = rgb.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    thumb = rgb.copy()
    thumb.thumbnail(THUMB_SIZE)
    # Nama thumbnail = id asset; file baru di thumbs/, file asli tidak disentuh.
    thumb.save(thumb_path, "WEBP")
    return "", {"lebar": width, "tinggi": height, "warna": f"#{r:02x}{g:02x}{b:02x}"}, thumb_path
