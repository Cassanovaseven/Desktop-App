"""Ekstraktor per format. Setiap fungsi menerima path file dan mengembalikan (teks, meta)."""

from pathlib import Path

from . import arsip, dokumen, gambar, teks

MAX_TEXT = 2_000_000


class ExtractError(Exception):
    """Ekstraksi gagal dengan pesan singkat berbahasa Indonesia untuk kartu."""


def extract_file(path: Path, asset_id: str, thumbs_dir: Path) -> dict:
    ext = path.suffix.lower().lstrip(".")
    thumb = None
    try:
        if ext == "pdf":
            text, meta = dokumen.pdf(path)
        elif ext == "docx":
            text, meta = dokumen.docx(path)
        elif ext == "pptx":
            text, meta = dokumen.pptx(path)
        elif ext == "xlsx":
            text, meta = dokumen.xlsx(path)
        elif ext == "epub":
            text, meta = dokumen.epub(path)
        elif ext in ("html", "htm"):
            text, meta = teks.html(path)
        elif ext in ("csv", "txt", "md"):
            text, meta = teks.plain(path)
        elif ext in teks.LANGUAGES:
            text, meta = teks.code(path, ext)
        elif ext in gambar.RASTER:
            text, meta, thumb = gambar.image(path, thumbs_dir / f"{asset_id}.webp")
        elif ext == "svg":
            text, meta = "", {"ukuran": path.stat().st_size}
        elif ext == "zip":
            text, meta = arsip.zip_entries(path)
        else:
            text, meta = "", {"ukuran": path.stat().st_size}
    except ExtractError:
        raise
    except dokumen.PdfError as e:
        raise ExtractError("PDF rusak atau terenkripsi") from e
    except dokumen.OfficeError as e:
        raise ExtractError("Dokumen rusak atau formatnya tidak didukung") from e
    except gambar.ImageError as e:
        raise ExtractError("Gambar rusak atau formatnya tidak didukung") from e
    except arsip.ZipError as e:
        raise ExtractError("ZIP rusak") from e
    return {"text": text[:MAX_TEXT], "meta": meta, "thumb": f"thumbs/{thumb.name}" if thumb else None}
