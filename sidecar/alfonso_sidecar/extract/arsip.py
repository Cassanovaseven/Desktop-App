import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

MAX_ENTRIES = 2000
MAX_TOTAL_BYTES = 2 * 1024**3


class ZipError(Exception):
    pass


def _safe_name(name: str) -> bool:
    p = PurePosixPath(name.replace("\\", "/"))
    return bool(name) and not p.is_absolute() and ".." not in p.parts and ":" not in name


def zip_entries(path: Path):
    """Membongkar entri aman ke folder sementara di luar vault. Proses utama mengimpornya lalu menghapus folder itu."""
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        raise ZipError(str(e)) from e
    with zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        total = sum(i.file_size for i in infos)
        if len(infos) > MAX_ENTRIES or total > MAX_TOTAL_BYTES:
            return "", {"entri": [], "ditolak": 0, "catatan": "ZIP terlalu besar untuk dibongkar otomatis"}
        temp_dir = Path(tempfile.mkdtemp(prefix="alfonso-zip-"))
        entries, rejected = [], 0
        try:
            for info in infos:
                if not _safe_name(info.filename):
                    rejected += 1
                    continue
                dest = temp_dir.joinpath(*PurePosixPath(info.filename.replace("\\", "/")).parts)
                dest.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(dest, "wb") as out:
                    shutil.copyfileobj(src, out)
                entries.append({"name": info.filename, "path": str(dest)})
        except Exception as e:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise ZipError(str(e)) from e
    names = "\n".join(e["name"] for e in entries)
    return names, {"entri": entries, "ditolak": rejected, "temp_dir": str(temp_dir)}
