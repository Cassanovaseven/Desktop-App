import { contextBridge, ipcRenderer } from 'electron'

// Jembatan sempit untuk jendela render p5: hanya menerima satu tugas dan mengirim frame/hasil kembali.
export interface RenderJob { code: string; seed: number; width: number; height: number; frames: number }

contextBridge.exposeInMainWorld('alfonsoRender', {
  onJob: (cb: (job: RenderJob) => void) => {
    ipcRenderer.once('render:job', (_e, job: RenderJob) => cb(job))
  },
  frame: (index: number, png: ArrayBuffer) => ipcRenderer.invoke('render:frame', index, png),
  done: () => ipcRenderer.send('render:done'),
  fail: (message: string) => ipcRenderer.send('render:fail', String(message).slice(0, 500))
})
