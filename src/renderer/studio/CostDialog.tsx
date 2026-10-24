import type { CostEstimate } from '../../shared/studio-types'

const fmt = (n: number): string => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })

export function costText(model: string, e: CostEstimate): string {
  if (e.perItem === null || e.total === null) return `Biaya untuk model ${model} belum diketahui. Isi harganya di Akun & biaya supaya perkiraan muncul.`
  return e.count > 1 ? `${e.count} × ${fmt(e.perItem)} kredit = ${fmt(e.total)} kredit` : `${fmt(e.total)} kredit`
}

/** Konfirmasi wajib sebelum generate cloud dikirim (spec 6: tidak ada kredit terpakai tanpa sepengetahuanmu). */
export function CostDialog(props: { model: string; estimate: CostEstimate; onConfirm(): void; onCancel(): void }): React.JSX.Element {
  return (
    <div className="studio-dialog-backdrop">
      <div className="studio-dialog" role="dialog" aria-modal="true" aria-labelledby="cost-title">
        <h3 id="cost-title">Konfirmasi biaya Higgsfield</h3>
        <p>{`Model: ${props.model}`}</p>
        <p className="studio-cost">{`Perkiraan biaya: ${costText(props.model, props.estimate)}`}</p>
        <p className="inspector-muted">Kredit terpotong di akun Higgsfield-mu. Gagal di server dicoba ulang otomatis maksimal 2 kali.</p>
        <div className="studio-actions">
          <button type="button" className="primary" onClick={props.onConfirm} autoFocus>
            Konfirmasi
          </button>
          <button type="button" onClick={props.onCancel}>
            Batal
          </button>
        </div>
      </div>
    </div>
  )
}
