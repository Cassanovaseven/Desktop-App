import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts'), render: resolve(__dirname, 'src/preload/render.ts') }
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        // render.html: halaman tersembunyi untuk sketsa p5 (jalur kode Studio).
        input: { index: resolve(__dirname, 'src/renderer/index.html'), render: resolve(__dirname, 'src/renderer/render.html') }
      }
    }
  }
})
