import { useEffect, useMemo, useRef, useState } from 'react'
import type { DockviewApi } from 'dockview-react'
import type { SidecarStatus, ThemeTokens } from '../shared/types'
import { applyTheme } from './theme/applyTheme'
import { Workspace } from './layout/Workspace'
import { buildDefaultLayout } from './layout/layout'
import { CommandPalette } from './palette/CommandPalette'
import { buildCommands } from './palette/commands'

export default function App(): React.JSX.Element {
  const [sidecar, setSidecar] = useState<SidecarStatus | null>(null)
  const [themes, setThemes] = useState<ThemeTokens[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const dockApi = useRef<DockviewApi | null>(null)
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void (async () => {
      const [list, activeId] = await Promise.all([window.alfonso.theme.list(), window.alfonso.theme.getActiveId()])
      setThemes(list)
      const active = list.find((t) => t.id === activeId)
      if (active) applyTheme(active)
    })()
    void window.alfonso.sidecar.getStatus().then(setSidecar)
    return window.alfonso.sidecar.onStatus(setSidecar)
  }, [])

  const commands = useMemo(
    () =>
      buildCommands({
        themes,
        api: window.alfonso,
        resetLayout: () => {
          const api = dockApi.current
          if (!api) return
          api.clear()
          buildDefaultLayout(api)
        },
        showMessage: (m) => {
          setMessage(m)
          if (messageTimer.current) clearTimeout(messageTimer.current)
          messageTimer.current = setTimeout(() => setMessage(null), 4000)
        },
        applyThemeById: (id) => {
          const t = themes.find((x) => x.id === id)
          if (!t) return
          applyTheme(t)
          void window.alfonso.theme.setActive(id)
        }
      }),
    [themes]
  )

  return (
    <div className="app">
      <Workspace sidecar={sidecar} onApi={(api) => (dockApi.current = api)} />
      <CommandPalette commands={commands} />
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </div>
  )
}
