# Alfonso

Papan kerja pribadi untuk Windows: riset, file, aset kreatif, dan hasil AI berkumpul di satu vault lokal.
Fase 0 (Inti): jendela Electron aman, vault + database, tema gelap/terang, sidecar Python, tata letak panel, dan command palette (Ctrl+K).

## Prasyarat

- Windows 10/11 x64
- Node.js 22 LTS
- Python 3.12 (peluncur `py` dipakai hanya untuk membuat venv)

## Memasang

```powershell
npm install
npm run sidecar:setup
```

`npm install` mengunduh Electron dan menyiapkan modul native (`better-sqlite3`).
`npm run sidecar:setup` membuat `sidecar\.venv` lalu memasang dependensi sidecar.

## Menjalankan

```powershell
npm run dev
```

Saat pertama kali jalan, Alfonso meminta folder vault, lalu membuat struktur `alfonso.db`, `files/`, `thumbs/`, `generated/`, `prompts/`, `mods/`, dan `logs/` di sana.
Tekan **Ctrl+K** untuk command palette (ganti tema, buka folder vault, status sidecar, reset tata letak).

Variabel environment opsional:

| Variabel | Fungsi |
| --- | --- |
| `ALFONSO_VAULT` | Pakai folder vault ini tanpa dialog (dipakai tes e2e) |
| `ALFONSO_USER_DATA` | Folder userData Electron (dipakai tes e2e) |
| `ALFONSO_PYTHON` | Path python sidecar, menggantikan `sidecar\.venv\Scripts\python.exe` |

## Tes

```powershell
npm test                                            # unit (Vitest)
sidecar\.venv\Scripts\python -m pytest sidecar/tests  # sidecar (pytest)
npm run build; npm run test:e2e                     # end-to-end (Playwright + Electron)
npm run typecheck                                   # TypeScript
```
