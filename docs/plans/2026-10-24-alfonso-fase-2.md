# Alfonso Fase 2 (Library) — Rencana TDD

> Status: **Disetujui Cassanova 2026-10-24. Selesai 2026-10-24** (laporan: /mnt/project-files/alfonso/laporan-fase-2.md).

**Goal:** Semua file di vault bisa dilihat, disaring, diberi tag, dan dipakai ulang dari satu panel Library, dan pekerjaan bisa dipisah per Proyek dan per Board. Ini menutup dua janji yang ditunda di Fase 1: "Library penuh" dan "pemilih proyek/board".

**Hasil yang bisa dipakai di akhir fase:**
- Panel kiri punya tab **Proyek** (daftar proyek dan board, bisa buat baru, ganti nama, pindah board) dan tab **Library** (semua aset dalam grid atau daftar).
- Library bisa dicari (isi file, nama, tag), disaring (jenis, status, tag, cakupan), dan diurutkan. Tetap lancar dengan 10.000 aset.
- Aset dari Library bisa diseret ke Board mana pun. Kartu baru menunjuk ke aset yang sama, tanpa menyalin file.
- Panel kanan **Inspector** menampilkan detail kartu/aset yang dipilih: pratinjau, info file, durasi/ukuran, status ekstraksi, cuplikan teks, tag (bisa diedit), dan daftar Board yang memakai aset itu.

**Spec:** bagian 2 (pilar 1: Board adalah pusat, modul lain cara lain melihat kartu yang sama), 3 (glosarium Project/Asset), 5 (entitas Project, Board, Asset, tabel `asset_tags`, FTS5), 8 (kiri: proyek, Library, pencarian; kanan: inspector), 9.1 (vault), 9.3 (taksonomi tag), 9.4 (ilustrasi keadaan kosong).

## Global Constraints

- Semua aturan Fase 0 dan 1 tetap berlaku (keamanan Electron, `window.alfonso`, Bahasa Indonesia, TDD, Allowed APIs, tidak ada log berisi token).
- **Tidak ada dependensi baru.** Grid Library yang panjang dirender dengan windowing buatan sendiri (baris tinggi tetap), tanpa pustaka virtualisasi.
- **Skema database tidak diubah.** Semua kebutuhan muat di tabel yang ada (lihat Keputusan desain).
- File di vault tidak pernah diubah, dipindah, atau dihapus. Library hanya membaca. Tidak ada tombol "hapus aset" di fase ini.
- Renderer tetap tidak menerima path absolut vault. "Tampilkan di folder" dijalankan di proses utama.

## Keputusan desain

1. **Board aktif disimpan di `settings`** (`board.active` = id board). Board yang hilang atau kosong → board pertama. Semua yang dulu memakai `getOrCreateDefaultBoard` (drop, tempel, catatan baru, viewport, folder dipantau, isi ZIP) sekarang memakai board aktif saat itu. Isi ZIP tetap masuk ke board tempat kartu ZIP-nya berada.
2. **Proyek sebuah aset diturunkan, bukan disimpan.** Tabel `assets` tidak punya `project_id`. Aset dianggap milik proyek bila ada kartunya di salah satu board proyek itu. Tag `proyek:<nama>` dari spec 9.3 tetap bisa ditambah manual. Karena itu tidak perlu ubah skema.
3. **Tag otomatis vs manual.** `jenis:*` dan `jalur:*` dibuat otomatis dan dikunci (tidak bisa dihapus di UI, karena akan dibuat lagi saat ekstraksi ulang). Tag lain bisa ditambah dan dihapus. Format tag dinormalkan: huruf kecil, spasi jadi `-`, maksimal 64 karakter, kelompok spec 9.3 (`jenis`, `jalur`, `status`, `proyek`, `gaya`, `sumber`) disarankan di kotak isian, tag bebas tanpa kelompok juga boleh. Setiap perubahan tag langsung memperbarui kolom `assets_fts.tags`, jadi tag bisa dicari.
4. **Cakupan Library:** "Semua aset", "Proyek ini" (aset yang punya kartu di board proyek aktif), dan "Belum dipakai" (aset tanpa kartu sama sekali, misalnya kartunya sudah dihapus). Ini cara menemukan kembali file yang kartunya terhapus, karena hapus kartu tidak pernah menghapus aset.
5. **Seret dari Library ke Board** memakai drag & drop HTML5 dengan tipe data khusus `application/x-alfonso-asset` berisi id aset saja. Board yang menerima memanggil `board:addAssetCard(assetId, titik)`. Tipe kartu mengikuti jenis aset (gambar → `gambar`, ZIP → `grup` tanpa membongkar ulang, lainnya → `file`/`kode`).
6. **Inspector** mengikuti pilihan terakhir: kartu yang dipilih di Board, atau aset yang diklik di Library. Kartu catatan/tautan menampilkan isinya saja. Cuplikan teks dibatasi 5.000 karakter pertama.
7. **"Dipakai di"**: daftar board (dengan nama proyek) yang punya kartu aset itu. Klik → pindah ke board itu dan Board memusatkan ke kartunya.
8. **"Tampilkan di folder"** memakai `shell.showItemInFolder` (hanya membuka Explorer dan menyorot file, tidak membuka atau mengubah isinya). Saya sengaja **tidak** membuat tombol "Buka dengan aplikasi bawaan", karena menyimpan dari Word/Photoshop akan mengubah file di vault dan merusak hash.
9. **Hapus proyek/board ditunda** (YAGNI dan aturan hapus). Ganti nama dan buat baru sudah cukup untuk memisah pekerjaan.
10. **Ilustrasi keadaan kosong (spec 9.4):** gaya visual belum ditetapkan, jadi Fase 2 memakai teks petunjuk di wadah yang nanti bisa diisi ilustrasi tanpa mengubah kode komponen.
11. **Tata letak lama:** tata letak tersimpan dari Fase 0/1 belum punya tab Library dan Inspector masih placeholder. Saat dimuat, panel yang belum ada ditambahkan di posisi bawaannya; susunan lain milikmu tidak diubah.

## Struktur file

```
src/main/projects/repo.ts         listProjects, createProject, renameProject, listBoards, createBoard, renameBoard,
                                  getActiveBoard, setActiveBoard
src/main/library/query.ts         listAssets (filter, urut, halaman), countByFacet
src/main/library/tags.ts          normalizeTag, listTags, addTag, removeTag, AUTO_TAG_GROUPS
src/main/library/detail.ts        getAssetDetail (aset + tag + cuplikan + dipakai di)
src/main/board/repo.ts            (diubah) loadBoard(boardId), saveViewport(boardId, v), addAssetCard
src/main/ingest/*.ts              (diubah) memakai board aktif
src/main/ipc.ts, src/preload/index.ts, src/shared/types.ts, src/shared/library-types.ts
src/renderer/projects/ProjectsPanel.tsx
src/renderer/library/LibraryPanel.tsx, LibraryGrid.tsx (windowing), LibraryFilters.tsx, windowing.ts
src/renderer/inspector/InspectorPanel.tsx, TagEditor.tsx
src/renderer/selection.ts         penyimpan pilihan bersama (Board/Library → Inspector)
src/renderer/layout/layout.ts     (diubah) panel library + inspector, ensurePanels untuk tata letak lama
src/renderer/palette/commands.ts  (diubah) perintah baru
```

## Allowed APIs tambahan (Fase 2)

Sumber dicek 2026-10-24 terhadap versi yang terkunci di `package.json`.

- **SQLite FTS5:** `UPDATE assets_fts SET tags = ? WHERE asset_id = ?` (tabel FTS5 biasa mendukung UPDATE). Filter + FTS digabung lewat `assets.id IN (SELECT asset_id FROM assets_fts WHERE assets_fts MATCH ?)`; urutan relevansi lewat `ORDER BY rank` hanya bila ada kata kunci. Halaman lewat `LIMIT ? OFFSET ?`; total lewat `COUNT(*)` dengan filter yang sama.
- **better-sqlite3:** `prepare().all/get/run`, `transaction()`; parameter `IN (…)` dibangun dengan placeholder `?` sebanyak isi array, tidak pernah dengan menyambung string nilai.
- **Electron:** `shell.showItemInFolder(fullPath)` di proses utama, path dari `vault.root` + `assets.vault_path`, dicek tetap di dalam `files/` (pola `path.relative` dari Fase 1).
- **dockview-react 8.6.1:** `api.getPanel(id)`, `api.addPanel({ id, component, title, position })`, `panel.api.setActive()`.
- **React Flow 12.12.0:** `onSelectionChange({ nodes })` untuk Inspector; `useReactFlow().fitView({ nodes: [{ id }] })` (sudah dipakai).
- **HTML5 drag & drop:** `e.dataTransfer.setData('application/x-alfonso-asset', id)`, `effectAllowed = 'copy'`; di Board `e.dataTransfer.types.includes(...)` lalu `getData`.
- **Windowing:** hanya baris yang terlihat + 2 baris cadangan yang dirender; tinggi baris tetap; `scrollTop` dari event `scroll`; lebar dari `ResizeObserver` untuk jumlah kolom.

**Anti-pattern:** menyambung nilai filter ke SQL, mengirim path absolut ke renderer, `shell.openPath` pada file vault, menghapus baris `assets`/file vault, memuat 10.000 aset sekaligus ke renderer.

## Task (TDD: tes dulu, lihat gagal, lalu kode)

### Task 1 — Proyek dan board (main)
Tes `tests/main/projects-repo.test.ts`: database kosong → "Proyek Pertama"/"Board Utama" dibuat sekali; buat proyek baru otomatis punya satu board; nama kosong/terlalu panjang (>80) ditolak; ganti nama; daftar urut sesuai dibuat; `setActiveBoard` id tak dikenal ditolak; board aktif bertahan setelah database dibuka ulang; setting rusak → board pertama.

### Task 2 — Semua jalur masuk memakai board aktif
Tes ubah `board-repo`, `importer`, `ingest-service`, `watcher`: catatan, drop, tempel teks/gambar, URL, folder dipantau masuk ke board aktif; isi ZIP masuk ke board kartu ZIP; `loadBoard(id)` dan `saveViewport(id, v)` hanya menyentuh board itu; tes Fase 1 lain tetap lulus.

### Task 3 — Kueri Library
Tes `tests/main/library-query.test.ts`: tanpa filter → urut terbaru; filter jenis (gabungan beberapa), status, tag (semua tag harus ada), cakupan proyek/belum dipakai; kata kunci memakai FTS (nama, tag, isi) dan mengembalikan cuplikan; urut nama/ukuran/terlama; halaman + total benar; input FTS aneh (`"`, `*`, `NEAR`) tidak error; 10.000 aset → satu halaman < 100 ms.

### Task 4 — Tag
Tes `tests/main/library-tags.test.ts`: normalisasi; tambah tag → muncul di pencarian; hapus tag manual → hilang dari pencarian; tag otomatis tidak bisa dihapus; daftar tag dengan jumlah aset; tag manual tetap ada setelah ekstraksi ulang (coba ulang).

### Task 5 — Detail aset dan "Tampilkan di folder"
Tes `tests/main/library-detail.test.ts`: detail berisi tag, meta, cuplikan maksimal 5.000 karakter, dan daftar board+proyek yang memakainya; aset tak dikenal → null; path untuk "tampilkan di folder" selalu di dalam `files/` (path vault palsu dengan `..` ditolak).

### Task 6 — IPC, preload, tipe
`window.alfonso.projects.*`, `library.*`, `board.addAssetCard`, `board.open(boardId?)`. Setiap handler memvalidasi input (pola `assert` yang ada). Tes: `npm run typecheck` + tes unit validasi untuk pembangun filter.

### Task 7 — Panel Proyek (renderer)
Tes RTL: daftar proyek dan board tampil; board aktif ditandai; klik board → `setActiveBoard` dan Board memuat ulang; "Proyek baru"/"Board baru" dengan kotak nama; F2/klik dua kali → ganti nama; Esc membatalkan.

### Task 8 — Panel Library (renderer)
Tes RTL: grid dan daftar bisa diganti; kotak cari dengan jeda 150 ms; chip jenis/status/tag/cakupan; urutan; jumlah hasil; keadaan kosong ("Library masih kosong", "Tidak ada yang cocok" + tombol hapus filter); status `memproses`/`gagal` terlihat di item; pembaruan dari `ingest:event` langsung terlihat. Tes `windowing.ts`: 10.000 item → hanya baris terlihat yang dirender, indeks benar saat digulir dan saat lebar berubah.

### Task 9 — Seret ke Board
Tes: item Library membawa `application/x-alfonso-asset`; drop di Board → `addAssetCard` di titik drop; file dari Explorer tetap jalur lama; tombol "Tambahkan ke Board" menaruh kartu di tengah layar. Tes main: `addAssetCard` tidak membuat aset atau file baru.

### Task 10 — Inspector
Tes RTL: pilih kartu di Board → detail aset; klik item Library → detail aset; kartu catatan → isi catatan; beberapa kartu dipilih → "N kartu dipilih"; editor tag (tambah dengan Enter, hapus dengan ×, tag otomatis tanpa ×); "Coba ulang" untuk ekstraksi gagal; "Dipakai di" → pindah board + fokus kartu; "Tampilkan di folder".

### Task 11 — Tata letak dan palette
Tes: tata letak bawaan punya Proyek+Library di kiri, Inspector di kanan; tata letak lama mendapat panel yang hilang tanpa mengubah yang lain; perintah Ctrl+K baru: "Buka Library", "Proyek baru…", "Board baru…", "Pindah ke board…", "Cari di Library…". "Cari isi file…" tetap ada; hasil yang kartunya ada di board lain akan pindah ke board itu dulu.

### Task 12 — E2E dan performa
`e2e/library.spec.ts`: buat proyek "Riset Hukum" → drop PDF → muncul di Library → saring Dokumen → beri tag `status:pilihan` → cari tag itu → seret ke board lain → jumlah file di `files/` tidak bertambah → Inspector "Dipakai di" menampilkan 2 board. `e2e/perf-library.spec.ts`: 10.000 aset palsu, gulir Library, ukur median/p95 waktu frame (target sama dengan Board: p95 ≤ 33 ms).

### Task 13 — Verifikasi dan laporan
`npm test`, `pytest`, `npm run typecheck`, `npm run build`, `npm run test:e2e` (Xvfb), pemindaian anti-pattern di atas. Laporan di `/mnt/project-files/alfonso/laporan-fase-2.md` dan panduan uji manual klik demi klik di `/mnt/project-files/alfonso/panduan-uji-manual-fase-2.md`.

## Di luar cakupan Fase 2

Generate dan riwayat prompt (Fase 3), Deck/Dashboard (Fase 4), hapus aset/proyek/board, ganti nama file aset, ilustrasi keadaan kosong bergambar (menunggu gaya visual), sinkron tag ke file asli.

## Daftar uji manual (untuk di laptop setelah selesai)

- [ ] Buat proyek baru, buat board kedua, pindah-pindah board: kartu tiap board terpisah dan posisi tersimpan.
- [ ] Library menampilkan semua file lama dari Fase 1, dengan thumbnail.
- [ ] Cari kata di dalam PDF dari kotak Library.
- [ ] Saring Gambar, lalu Video; urutkan berdasar ukuran.
- [ ] Tambah tag `status:final` ke satu file, lalu cari "final".
- [ ] Seret gambar dari Library ke board lain; Inspector "Dipakai di" menunjukkan dua board.
- [ ] Hapus kartu dari Board; aset masih ada di Library dengan cakupan "Belum dipakai".
- [ ] "Tampilkan di folder" membuka Explorer di file yang benar.
