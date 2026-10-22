import type { AlfonsoApi } from '../shared/types'

declare global {
  interface Window {
    alfonso: AlfonsoApi
  }
}
