import { useEffect, useState } from 'react'
import type { SidecarStatus } from '../shared/types'
import { applyTheme } from './theme/applyTheme'
import { Workspace } from './layout/Workspace'

export default function App(): React.JSX.Element {
  const [sidecar, setSidecar] = useState<SidecarStatus | null>(null)

  useEffect(() => {
    void (async () => {
      const [themes, activeId] = await Promise.all([window.alfonso.theme.list(), window.alfonso.theme.getActiveId()])
      const active = themes.find((t) => t.id === activeId)
      if (active) applyTheme(active)
    })()
    void window.alfonso.sidecar.getStatus().then(setSidecar)
    return window.alfonso.sidecar.onStatus(setSidecar)
  }, [])

  return (
    <div className="app">
      <Workspace sidecar={sidecar} />
    </div>
  )
}
