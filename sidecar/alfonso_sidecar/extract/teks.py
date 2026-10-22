from html.parser import HTMLParser
from pathlib import Path

LANGUAGES = {
    "py": "python", "ts": "typescript", "tsx": "typescript", "js": "javascript", "jsx": "javascript", "mjs": "javascript",
    "cjs": "javascript", "json": "json", "yaml": "yaml", "yml": "yaml", "toml": "toml", "xml": "xml", "css": "css",
    "scss": "scss", "sql": "sql", "sh": "shell", "ps1": "powershell", "bat": "batch", "java": "java", "kt": "kotlin",
    "c": "c", "h": "c", "cpp": "cpp", "hpp": "cpp", "cs": "csharp", "go": "go", "rs": "rust", "rb": "ruby", "php": "php",
    "swift": "swift", "lua": "lua", "r": "r", "dart": "dart", "vue": "vue", "svelte": "svelte",
}


def read_text(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


class _Stripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.parts.append(data.strip())


def strip_html(source: str) -> str:
    p = _Stripper()
    p.feed(source)
    p.close()
    return " ".join(p.parts)


def html(path: Path):
    return strip_html(read_text(path)), {}


def plain(path: Path):
    return read_text(path), {}


def code(path: Path, ext: str):
    return read_text(path), {"bahasa": LANGUAGES[ext]}
