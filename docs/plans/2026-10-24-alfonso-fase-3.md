# Alfonso Fase 3 (Studio AI) — Rencana TDD

> Status: **Draf, menunggu persetujuan Cassanova** (2026-10-24). Belum ada kode yang ditulis.

**Goal:** Membuat aset baru dari dalam Alfonso lewat tiga jalur (cloud Higgsfield, lokal ComfyUI, kode), dengan setiap hasil tercatat asal-usulnya (prompt, versi, model, parameter, biaya) dan bisa di-generate ulang dengan satu klik. Ini menutup kriteria sukses spec ke-2.

**Hasil yang bisa dipakai di akhir fase:**
- Tab **Studio** (tengah) berisi **Prompt library** (daftar, cari, editor dengan variabel `[NAMA]`, versi, contoh hasil) dan **formulir generate** (pilih prompt, isi variabel, pilih jalur + model + parameter, kartu referensi).
- **Jalur kode** jalan tanpa internet dan tanpa GPU: template SVG atau sketsa p5.js → gambar PNG/SVG; sketsa p5.js beranimasi → video MP4 pendek.
- **Jalur cloud (Higgsfield)**: kunci API disimpan terenkripsi, perkiraan biaya kredit tampil dan harus dikonfirmasi, gagal dicoba ulang maksimal 2 kali.
- **Jalur lokal (ComfyUI)**: memakai ComfyUI yang sudah kamu jalankan sendiri di laptop, dengan workflow JSON yang kamu ekspor dari ComfyUI. Kalau ComfyUI mati, Studio menawarkan pindah ke cloud (tidak pindah sendiri).
- **Klik kanan kartu → "Generate dari ini"**: kartu jadi referensi; hasil muncul sebagai kartu di sebelahnya dengan panah.
- **Inspector** untuk aset hasil generate menampilkan prompt, versi, model, parameter, jalur, biaya, dan tombol **Generate ulang**.
- Panel **Antrean & Log** menampilkan generate yang sedang berjalan, gagal (dengan tombol coba ulang), dan selesai.

**Spec:** bagian 2 (pilar 3: setiap aset punya asal-usul), 3 (Prompt, Generation, Jalur, Adapter), 5 (entitas Prompt & Generation, alur 2 generate), 6 (adapter Higgsfield, ComfyUI, render kode; aturan keamanan kunci & biaya), 7 (generate cloud gagal, ComfyUI tidak berjalan, tes kontrak adapter dengan mock, e2e jalur kode), 9.1–9.3 (folder `generated/`, `prompts/`, konvensi nama, tag otomatis), 10.1 (skema template prompt).

## Global Constraints

- Semua aturan Fase 0–2 tetap berlaku (keamanan Electron, `window.alfonso`, Bahasa Indonesia, TDD, Allowed APIs, tidak ada log berisi token).
- **Tidak ada tes yang memakai kredit sungguhan atau internet.** Higgsfield dan ComfyUI diuji dengan server tiruan (sukses, gagal, lambat).
- **Kunci API** hanya disimpan sebagai ciphertext `safeStorage` (DPAPI Windows) di tabel `settings`. Renderer tidak pernah menerima kunci; ia hanya tahu "tersimpan / belum". Kunci dikirim ke sidecar per permintaan lewat header, dan `redact()` di logger ditambah kunci itu.
- **Generate cloud selalu konfirmasi biaya** sebelum dikirim, termasuk "Generate ulang" dan "Coba ulang" manual.
- File di vault tidak pernah diubah atau dihapus. Hasil generate adalah file **baru** di `generated/`.
- Kode pengguna di jalur kode (p5/SVG) dijalankan di jendela tersembunyi yang terkunci: `sandbox`, `contextIsolation`, tanpa `nodeIntegration`, CSP ketat, dan semua permintaan jaringan diblokir.

## Yang perlu kamu setujui

**Dependensi baru (2):**

| Paket | Versi | Lisensi | Dipakai untuk | Catatan |
| --- | --- | --- | --- | --- |
| `higgsfield-client` (pip, sidecar) | 0.2.0 (rilis 2026-09-17) | Apache-2.0 | Jalur cloud Higgsfield | SDK resmi dari spec. Hanya butuh `httpx`, yang sudah terpasang (0.28.1 cocok). Bisa diarahkan ke server tiruan untuk tes. |
| `p5` (npm) | 2.3.4 (rilis 2026-09-25) | LGPL-2.1 | Jalur kode code→image dan code→motion | Dimuat hanya di jendela render tersembunyi. LGPL aman untuk aplikasi pribadi yang tidak dijual. |

ComfyUI **tidak** butuh paket baru (dipanggil lewat `httpx` dari sidecar). Video MP4 dari p5 dirakit dengan `av` (PyAV), yang sudah terpasang sejak Fase 1B.

**Remotion tidak saya masukkan** walau disebut di spec bagian 6. Alasannya: Remotion menarik bundler webpack, mengunduh Chrome headless terpisah (~100 MB), dan punya lisensi khusus. p5 + PyAV sudah cukup untuk animasi splash 4 detik (spec 9.4). Kalau nanti perlu animasi yang lebih rumit, Remotion bisa ditambah sebagai adapter terpisah.

**Perubahan skema (migrasi v3, hanya menambah kolom, tidak menghapus data):**

```sql
ALTER TABLE prompts ADD COLUMN params_json TEXT;      -- parameter bawaan (spec 10.1 "parameter": rasio, jumlah, …)
ALTER TABLE prompts ADD COLUMN created_at TEXT;
ALTER TABLE generations ADD COLUMN prompt_text TEXT;  -- teks prompt final setelah variabel diisi (asal-usul lengkap)
ALTER TABLE generations ADD COLUMN source TEXT;       -- higgsfield | comfyui | p5 | svg (tag sumber, spec 9.3)
ALTER TABLE generations ADD COLUMN external_id TEXT;  -- id permintaan di Higgsfield/ComfyUI, supaya coba ulang tidak bayar dua kali
ALTER TABLE generations ADD COLUMN error TEXT;
ALTER TABLE generations ADD COLUMN updated_at TEXT;
```

**Git push:** tetap saya tanyakan dulu setelah semua task selesai.

## Keputusan desain

1. **Versi prompt tidak pernah ditimpa.** Menyimpan perubahan membuat baris baru (`version + 1`, `parent_version_id` = versi sebelumnya). Library hanya menampilkan versi terbaru; riwayat versi bisa dibuka di editor. Generation selalu menunjuk ke baris versi yang dipakai, jadi "Generate ulang" memakai versi yang sama persis walau prompt sudah diedit.
2. **Variabel** ditulis `[NAMA]` seperti di spec 10 (huruf besar, angka, `_`). Daftar variabel dideteksi otomatis dari template. Variabel kosong menolak generate dengan pesan jelas.
3. **Prompt tanpa disimpan:** menulis prompt baru lalu langsung generate tetap membuat baris prompt (versi 1, nama "Tanpa judul …"), supaya asal-usul tidak hilang.
4. **Satu Generation = satu hasil.** Parameter `jumlah: 4` membuat 4 baris Generation (biaya dikali 4 di dialog konfirmasi). Ini cocok dengan kolom `result_asset_id` yang tunggal.
5. **Generation berjalan di antrean `jobs`** (jenis `generate`) dengan `JobQueue` yang sudah ada: crash → dilanjutkan. Cloud: `maxAttempts 3` (= coba ulang 2 kali) dengan jeda bertambah. Bila `external_id` sudah ada, coba ulang **hanya menanyakan status**, tidak mengirim ulang (tidak bayar dua kali). Gagal 4xx (kunci salah, NSFW, parameter salah) langsung gagal tanpa coba ulang.
6. **Perkiraan biaya.** SDK Higgsfield tidak punya endpoint harga (dicek dari kode SDK 0.2.0). Jadi Studio memakai tabel "kredit per generate" per model yang kamu isi sendiri (disimpan di `settings`). Model tanpa harga → dialog menulis "biaya belum diketahui" dan tetap minta konfirmasi. Nilai perkiraan dicatat di `credit_cost`. Saldo kredit tidak ditampilkan di fase ini (Dashboard, Fase 4).
7. **Model Higgsfield** diisi sebagai teks id aplikasi (mis. `bytedance/seedream/v4/text-to-image`), dengan daftar model yang pernah dipakai sebagai saran. Tidak ada katalog model bawaan, karena daftar model Higgsfield sering berubah.
8. **Referensi gambar.** "Generate dari ini" pada kartu gambar: cloud → diunggah lewat `upload_file` SDK lalu URL-nya dikirim sebagai parameter gambar; ComfyUI → diunggah ke `/upload/image`; kode → tersedia sebagai variabel `[SUMBER_TEKS]` (teks ekstraksi kartu) dan `[SUMBER_GAMBAR]` (URL `alfonso-vault://`).
9. **ComfyUI.** Alamat bawaan `http://127.0.0.1:8188` (bisa diganti, hanya `127.0.0.1`/`localhost` yang diterima). Prompt jalur lokal menyimpan workflow ComfyUI format API (hasil "Export (API)" di ComfyUI) sebagai aset di vault; Alfonso mengganti penanda `{{PROMPT}}`, `{{NEGATIF}}`, `{{SEED}}`, `{{LEBAR}}`, `{{TINGGI}}` lalu `POST /prompt`, memantau `/history/{id}`, dan mengambil hasil lewat `/view`. Pemilihan model gambar lokal untuk 8 GB VRAM tetap keputusan terbuka di spec; Alfonso tidak memaksa model tertentu.
10. **Jalur kode.**
    - **SVG:** template berisi markup SVG dengan `[VARIABEL]`. Hasil disimpan sebagai `.svg` setelah dicek (harus `<svg>` valid, tanpa `<script>`, tanpa `href` ke luar).
    - **p5 gambar:** sketsa dijalankan di jendela tersembunyi, setelah `setup()` + 1 frame (atau saat sketsa memanggil `alfonsoSelesai()`), kanvas diambil sebagai PNG.
    - **p5 motion:** parameter `durasi` (maks 20 detik) dan `fps` (24/30). Frame diambil satu per satu dengan `frameRate` deterministik (`randomSeed`/`noiseSeed` dari parameter `seed`), dikirim ke sidecar, dirakit menjadi MP4 H.264 dengan PyAV.
    - Batas waktu render 30 detik (gambar) / 2 menit (motion); lebih dari itu → gagal "sketsa terlalu lama".
11. **Penyimpanan hasil** di `generated/YYYY-MM/<proyek>_<jenis>_<subjek>_<jalur>_<YYYYMMDD>_<nnn>.<ext>` (spec 9.2). `subjek` = nama prompt yang di-slug. Tetap dihitung SHA-256; bila hasil identik dengan aset yang sudah ada, aset lama dipakai. Sidecar diizinkan mengekstrak dari `generated/` juga (sekarang hanya `files/`). Tag otomatis: `jenis:*`, `jalur:<cloud|lokal|kode>`, `sumber:<higgsfield|comfyui|p5|svg>`, `status:draf`.
12. **Penempatan kartu hasil.** Ada kartu sumber → di kanan kartu sumber (bertumpuk ke bawah untuk hasil ke-2, ke-3, …) dengan link `kind = 'hasil'`. Tanpa sumber → di tengah viewport board aktif. Kartu hasil masuk ke board tempat generate dimulai, walau board aktif sudah pindah.
13. **Kunci Higgsfield** dimasukkan di Studio → "Akun" (kolom API key + secret). Status adapter: `belum diatur`, `tersimpan`, `ditolak` (401 dari Higgsfield → "perlu login ulang", tombol generate cloud nonaktif sampai kunci diganti). Tombol "Hapus kunci" menghapus ciphertext dari `settings`.
14. **Ekspor prompt** ke `prompts/<id>.json` (format spec 10.1) setiap kali prompt disimpan, untuk backup. File ini milik Alfonso, bukan file asli pengguna, jadi boleh ditimpa.

## Struktur file

```
src/main/db/database.ts           (diubah) migrasi v3
src/main/studio/prompts.ts        listPrompts, getPrompt, savePrompt (versi baru), promptHistory, exportPrompt, parseVariables, fillTemplate
src/main/studio/generations.ts    createGenerations, getGeneration, listGenerations, markRunning/Done/Failed, regenerateParams
src/main/studio/costs.ts          getCostTable, setModelCost, estimate
src/main/studio/keys.ts           saveKey, hasKey, readKey, clearKey (safeStorage, bisa di-mock)
src/main/studio/naming.ts         generatedFileName (spec 9.2), slug
src/main/studio/results.ts        saveResultAsset (generated/ + hash + tag + kartu + link)
src/main/studio/runner.ts         jalankan job 'generate' → adapter sesuai jalur
src/main/studio/adapters/code.ts  SVG (validasi) + p5 (jendela render tersembunyi)
src/main/studio/render-window.ts  BrowserWindow tersembunyi untuk p5
src/main/studio/adapters/cloud.ts, local.ts   klien sidecar /generate/higgsfield & /generate/comfyui
src/main/ipc.ts, src/preload/index.ts, src/shared/studio-types.ts, src/shared/types.ts
src/renderer/studio/StudioPanel.tsx, PromptLibrary.tsx, PromptEditor.tsx, GenerateForm.tsx, CostDialog.tsx, AccountSettings.tsx, GenerationList.tsx
src/renderer/studio/render.html + render.ts    halaman render p5 (entri renderer kedua)
src/renderer/inspector/InspectorPanel.tsx      (diubah) bagian "Asal-usul" + Generate ulang
src/renderer/board/Board.tsx                   (diubah) menu klik kanan "Generate dari ini"
sidecar/alfonso_sidecar/generate/higgsfield.py, comfyui.py, video.py
sidecar/alfonso_sidecar/app.py                 (diubah) endpoint /generate/*, /encode/video, ekstrak dari generated/
```

## Allowed APIs tambahan (Fase 3)

Dicek 2026-10-24 terhadap versi yang akan dikunci.

- **higgsfield-client 0.2.0** (dari kode paket): `SyncClient(base_url=..., timeout=..., api_key="key:secret")`, `client.submit(application, arguments) → controller` (`request_id`, `status()`, `get()`, `cancel()`), `client.status(request_id)`, `client.result(request_id)`, `client.upload_file(path) → url`. Status: `Queued`, `InProgress`, `Completed`, `Failed`, `NSFW`, `Cancelled`. Header otentikasi `Authorization: Key <key:secret>`. Kunci **tidak** diambil dari variabel lingkungan; selalu lewat `api_key`.
- **ComfyUI HTTP API:** `GET /system_stats` (cek hidup), `POST /prompt {prompt, client_id} → {prompt_id}`, `GET /history/{prompt_id}`, `GET /view?filename=&subfolder=&type=`, `POST /upload/image` (multipart).
- **Electron 45:** `safeStorage.isEncryptionAvailable()`, `encryptString()`, `decryptString()`; `BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload } })`; `session.fromPartition('alfonso-render').webRequest.onBeforeRequest` untuk memblokir jaringan; `webContents.on('will-navigate')` dicegah.
- **p5 2.3.4:** mode instance `new p5((s) => { s.setup; s.draw }, el)`, `s.randomSeed`, `s.noiseSeed`, `s.noLoop`, `s.redraw`, `s.frameRate`; kanvas diambil dengan `canvas.toDataURL('image/png')` / `toBlob`.
- **PyAV 19:** `av.open(path, 'w')`, `add_stream('libx264', rate=fps)`, `av.VideoFrame.from_image(PIL.Image)`, `stream.encode()`, `pix_fmt = 'yuv420p'`.

## Task

Setiap task: tulis tes dulu, lihat gagal, tulis kode, lihat lulus, commit.

1. **Migrasi v3.** Tes: database v2 → v3 menambah 7 kolom, data lama utuh; database baru langsung v3; membuka ulang tidak mengulang migrasi.
2. **Prompt library (main).** Tes: `parseVariables` (`[SIMBOL]`, duplikat, `[a]` bukan variabel), `fillTemplate` (variabel kosong ditolak), simpan → versi 1; simpan ulang → versi 2 dengan `parent_version_id`, versi 1 tidak berubah; daftar hanya versi terbaru; cari nama; ekspor `prompts/<id>.json` sesuai spec 10.1; nama kosong / > 80 karakter ditolak.
3. **Generation & biaya (main).** Tes: `jumlah 4` → 4 baris `antre` + 4 job; `estimate` dari tabel biaya (dikali jumlah, model tanpa harga → `null`); transisi status; `regenerateParams` menyalin prompt versi, variabel, model, parameter, jalur, sumber persis.
4. **Kunci terenkripsi.** Tes (safeStorage di-mock): simpan → `settings` hanya berisi ciphertext base64; `hasKey`; baca kembali; hapus; enkripsi tidak tersedia → error jelas, tidak menyimpan teks polos; kunci masuk daftar `redact()`.
5. **Penamaan & penyimpanan hasil.** Tes: nama spec 9.2 (nomor urut per hari, slug aman Windows, tanpa karakter terlarang); file ditulis ke `generated/YYYY-MM/`; hash identik → aset lama; tag otomatis; kartu di kanan kartu sumber + link `hasil`; tanpa sumber → tengah viewport; board asal dipakai walau board aktif pindah.
6. **Sidecar: adapter Higgsfield.** pytest dengan server tiruan (`httpx.MockTransport` / FastAPI palsu): sukses → file hasil diunduh ke folder sementara; gagal 5xx → error sementara; 401 → "kunci ditolak" permanen; NSFW → permanen dengan pesan; lambat → batas waktu; `external_id` yang sudah ada → hanya cek status, tidak `submit` ulang; header token Alfonso tetap wajib; kunci tidak muncul di respons/log.
7. **Sidecar: adapter ComfyUI.** pytest dengan server tiruan: penanda `{{PROMPT}}` dkk. diganti; `/system_stats` mati → error "ComfyUI tidak berjalan" (permanen, tidak dicoba ulang); alamat selain localhost ditolak; hasil diambil dari `/view`; unggah referensi.
8. **Sidecar: rakit video.** pytest: 30 frame PNG → MP4 berdurasi 1 detik pada 30 fps, bisa dibuka ulang dengan PyAV; frame ukuran beda ditolak; batas jumlah frame.
9. **Jalur kode.** Tes: validasi SVG (tolak `<script>`, `on*=`, `href` http); p5 gambar & motion di jendela render (tes e2e kecil di Electron); jaringan diblokir (sketsa yang `fetch` gagal tanpa keluar); batas waktu.
10. **Runner + antrean.** Tes (adapter palsu): job `generate` memanggil adapter sesuai jalur; sukses → aset + kartu + event ke renderer; gagal sementara → coba ulang dengan jeda bertambah, maksimal 3 percobaan; gagal permanen → langsung `gagal` + pesan; crash di tengah → dilanjutkan; `external_id` tersimpan sebelum menunggu hasil.
11. **IPC + preload.** Tes: semua handler memvalidasi input (jalur, panjang teks, angka parameter); renderer tidak pernah menerima kunci atau path absolut; typecheck bersih.
12. **UI Studio.** Tes RTL: daftar & cari prompt; editor mendeteksi variabel dan menyimpan versi baru; formulir menolak variabel kosong; jalur cloud → dialog biaya muncul dan generate hanya terkirim setelah "Konfirmasi"; ComfyUI mati → tawaran pindah ke cloud (tidak otomatis); kunci belum diatur → tombol cloud nonaktif dengan tautan ke "Akun"; daftar riwayat + tombol coba ulang.
13. **Board & Inspector.** Tes RTL: klik kanan kartu → "Generate dari ini" membuka Studio dengan kartu sebagai referensi; Inspector aset hasil menampilkan asal-usul; "Generate ulang" mengisi formulir dengan nilai yang sama (cloud tetap minta konfirmasi biaya); Ctrl+K: "Buka Studio", "Prompt baru…", "Generate dari kartu terpilih".
14. **E2E & verifikasi.** `e2e/studio.spec.ts`: buat prompt SVG dengan variabel → generate → kartu hasil muncul di board dengan panah dari kartu sumber → Inspector menunjukkan asal-usul → Generate ulang → kartu kedua; p5 motion → kartu video; cloud & ComfyUI dengan server tiruan (tanpa kredit). Lalu `npm test`, `pytest`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, pemindaian anti-pattern (kunci di log/settings teks polos, path absolut ke renderer, generate cloud tanpa konfirmasi). Laporan + panduan uji manual klik demi klik.

## Di luar cakupan

Saldo/ringkasan kredit (Fase 4 Dashboard), Remotion, katalog model Higgsfield bawaan, instalasi atau pengaturan ComfyUI itu sendiri, hapus prompt/generation, adapter lewat mod (Fase 6), generate video/audio dengan model cloud di luar text→image dan image→image (bisa ditambah setelah adapter dasar jalan).

## Risiko

- **Model Higgsfield butuh parameter berbeda-beda.** Parameter prompt disimpan sebagai JSON bebas yang diteruskan apa adanya; Studio hanya memberi kolom umum (rasio, jumlah, seed). Uji asli tetap perlu di laptopmu karena container ini tidak bisa menghubungi Higgsfield.
- **Kredit API Higgsfield** mungkin terpisah dari langganan aplikasinya (keputusan terbuka spec 12). Perlu kamu cek di cloud.higgsfield.ai sebelum uji manual.
- **ComfyUI di Windows** harus kamu pasang dan jalankan sendiri; Alfonso hanya menyambung ke situ.
