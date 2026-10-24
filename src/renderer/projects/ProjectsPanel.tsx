import { useCallback, useEffect, useState } from 'react'
import type { ProjectDTO } from '../../shared/library-types'
import { useWorkspace, workspace } from '../workspace'
import { openBoard } from '../navigation'

type Editing =
  | { kind: 'newProject' }
  | { kind: 'newBoard'; projectId: string }
  | { kind: 'renameProject'; id: string; name: string }
  | { kind: 'renameBoard'; id: string; name: string }
  | null

const LABEL: Record<NonNullable<Editing>['kind'], string> = {
  newProject: 'Nama proyek baru',
  newBoard: 'Nama board baru',
  renameProject: 'Ganti nama proyek',
  renameBoard: 'Ganti nama board'
}

function NameInput(props: { label: string; initial: string; onSubmit: (name: string) => void; onCancel: () => void }): React.JSX.Element {
  const [value, setValue] = useState(props.initial)
  return (
    <input
      className="tree-input"
      aria-label={props.label}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={props.onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          props.onSubmit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          props.onCancel()
        }
      }}
    />
  )
}

export function ProjectsPanel(): React.JSX.Element {
  const api = window.alfonso.projects
  const activeBoardId = useWorkspace((s) => s.activeBoardId)
  const version = useWorkspace((s) => s.projectsVersion)
  const [projects, setProjects] = useState<ProjectDTO[] | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => api.list().then(setProjects, (e: Error) => setError(e.message)), [api])
  useEffect(() => {
    void reload()
  }, [reload, version])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
      setEditing(null)
      await reload()
      workspace.bumpProjects()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const submit = (name: string): void => {
    const e = editing
    if (!e) return
    if (e.kind === 'newProject')
      void run(async () => {
        const p = await api.create(name)
        await openBoard(p.boards[0].id, p.id)
      })
    else if (e.kind === 'newBoard')
      void run(async () => {
        const b = await api.createBoard(e.projectId, name)
        await openBoard(b.id, e.projectId)
      })
    else if (e.kind === 'renameProject') void run(() => api.rename(e.id, name))
    else void run(() => api.renameBoard(e.id, name))
  }

  const input = (initial = ''): React.JSX.Element => (
    <NameInput label={LABEL[editing!.kind]} initial={initial} onSubmit={submit} onCancel={() => setEditing(null)} />
  )

  return (
    <div className="projects-panel">
      <div className="panel-toolbar">
        <button type="button" onClick={() => setEditing({ kind: 'newProject' })}>
          Proyek baru
        </button>
      </div>
      {error && (
        <div className="panel-error" role="alert">
          {error}
        </div>
      )}
      {editing?.kind === 'newProject' && input()}
      {!projects && <div className="panel-placeholder">Memuat proyek…</div>}
      <ul className="tree">
        {projects?.map((p) => (
          <li key={p.id}>
            <div className="tree-project">
              {editing?.kind === 'renameProject' && editing.id === p.id ? (
                input(p.name)
              ) : (
                <span
                  className="tree-project-name"
                  tabIndex={0}
                  onDoubleClick={() => setEditing({ kind: 'renameProject', id: p.id, name: p.name })}
                  onKeyDown={(e) => e.key === 'F2' && setEditing({ kind: 'renameProject', id: p.id, name: p.name })}
                >
                  {p.name}
                </span>
              )}
              <button type="button" className="tree-add" aria-label="Board baru" title="Board baru" onClick={() => setEditing({ kind: 'newBoard', projectId: p.id })}>
                +
              </button>
            </div>
            <ul>
              {p.boards.map((b) => (
                <li key={b.id}>
                  {editing?.kind === 'renameBoard' && editing.id === b.id ? (
                    input(b.name)
                  ) : (
                    <button
                      type="button"
                      className={b.id === activeBoardId ? 'tree-board active' : 'tree-board'}
                      aria-current={b.id === activeBoardId ? 'true' : undefined}
                      onClick={() => void openBoard(b.id, p.id).catch((e: Error) => setError(e.message))}
                      onDoubleClick={() => setEditing({ kind: 'renameBoard', id: b.id, name: b.name })}
                      onKeyDown={(e) => {
                        if (e.key === 'F2') {
                          e.preventDefault()
                          setEditing({ kind: 'renameBoard', id: b.id, name: b.name })
                        }
                      }}
                    >
                      {b.name}
                    </button>
                  )}
                </li>
              ))}
              {editing?.kind === 'newBoard' && editing.projectId === p.id && <li>{input()}</li>}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
