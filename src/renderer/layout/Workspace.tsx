import { createContext, useContext, useEffect, useRef } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import type { SidecarStatus } from '../../shared/types'
import { restoreLayout, sidecarLabel } from './layout'
import { Board } from '../board/Board'
import { ProjectsPanel } from '../projects/ProjectsPanel'
import { LibraryPanel } from '../library/LibraryPanel'
import { InspectorPanel } from '../inspector/InspectorPanel'

const SidecarContext = createContext<SidecarStatus | null>(null)

function Placeholder(props: IDockviewPanelProps<{ text?: string }>): React.JSX.Element {
  // Tata letak tersimpan dari Fase 0/1 masih memakai komponen placeholder untuk panel yang kini sudah jadi.
  if (props.api.id === 'board') return <Board />
  if (props.api.id === 'explorer') return <ProjectsPanel />
  if (props.api.id === 'inspector') return <InspectorPanel />
  return <div className="panel-placeholder">{props.params.text}</div>
}

function QueuePanel(): React.JSX.Element {
  const status = useContext(SidecarContext)
  return (
    <div className="panel-queue">
      <div className={`sidecar-status sidecar-${status?.state ?? 'starting'}`}>{sidecarLabel(status)}</div>
    </div>
  )
}

const components = {
  placeholder: Placeholder,
  queue: QueuePanel,
  board: () => <Board />,
  projects: () => <ProjectsPanel />,
  library: () => <LibraryPanel />,
  inspector: () => <InspectorPanel />
}
const theme = { name: 'alfonso', className: 'dockview-theme-alfonso' }

export function Workspace(props: { sidecar: SidecarStatus | null; onApi?: (api: DockviewApi) => void }): React.JSX.Element {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const onReady = (e: DockviewReadyEvent): void => {
    const api = e.api
    props.onApi?.(api)
    void window.alfonso.layout.load().then((saved) => {
      restoreLayout(api, saved, (m) => console.warn(m))
      api.onDidLayoutChange(() => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          void window.alfonso.layout.save(JSON.stringify(api.toJSON()))
        }, 500)
      })
    })
  }

  return (
    <SidecarContext.Provider value={props.sidecar}>
      <DockviewReact components={components} onReady={onReady} theme={theme} />
    </SidecarContext.Provider>
  )
}
