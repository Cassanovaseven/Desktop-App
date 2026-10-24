import { workspace } from './workspace'

/** Pindah board: disimpan di proses utama dulu, baru Board di layar ikut pindah. */
export async function openBoard(boardId: string, projectId: string): Promise<void> {
  await window.alfonso.projects.setActiveBoard(boardId)
  workspace.setActiveBoard(boardId, projectId)
}

/** Memusatkan Board ke sebuah kartu, pindah board dulu bila kartunya ada di board lain. */
export async function goToCard(cardId: string, loc?: { boardId: string; projectId: string }): Promise<boolean> {
  const where = loc ?? (await window.alfonso.board.locate(cardId))
  if (!where) return false
  if (where.boardId !== workspace.get().activeBoardId) await openBoard(where.boardId, where.projectId)
  workspace.requestFocus(cardId)
  return true
}
