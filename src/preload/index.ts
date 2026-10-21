import { contextBridge, ipcRenderer } from 'electron'

export type PobTarget = {
  pid: number
  buildName: string | null
}

contextBridge.exposeInMainWorld('pobBridge', {
  getState: (): Promise<{ targets: PobTarget[]; selectedPid: number | null }> => ipcRenderer.invoke('pob:get-state'),
  selectTarget: (pid: number): Promise<{ target: PobTarget } | { error: string }> =>
    ipcRenderer.invoke('pob:select-target', pid),
  onTargetsChanged: (callback: (state: { targets: PobTarget[]; selectedPid: number | null }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: { targets: PobTarget[]; selectedPid: number | null }) => callback(state)
    ipcRenderer.on('pob:targets-changed', listener)
    return () => ipcRenderer.removeListener('pob:targets-changed', listener)
  },
})

declare global {
  interface Window {
    pobBridge: {
      getState: () => Promise<{ targets: PobTarget[]; selectedPid: number | null }>
      selectTarget: (pid: number) => Promise<{ target: PobTarget } | { error: string }>
      onTargetsChanged: (callback: (state: { targets: PobTarget[]; selectedPid: number | null }) => void) => () => void
    }
  }
}
