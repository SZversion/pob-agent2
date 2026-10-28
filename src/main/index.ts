import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { PobBridgeService, type PobTarget } from './pob-bridge'
import { PobWatcher } from './pob-watcher'
import { connectToWatcher } from './watcher-client'
import { loadWatcherNative, type WatcherNative } from './watcher-native'

let mainWindow: BrowserWindow | null = null
let pobBridge: PobBridgeService | null = null
let selectedPid: number | null = null
let hasSelectedTarget = false
let watcherNative: WatcherNative | null = null
let disconnectWatcher: (() => void) | null = null
const confirmedPids = new Set<number>()
// shortcut: a late PoB state file can miss this window; increase it or use readiness signaling if startup is slower.
const AUTO_CONNECT_DELAY = 2000
let autoConnectTimer: ReturnType<typeof setTimeout> | null = null
let previousTargetPids = ''

function scheduleAutoConnect(): void {
  if (hasSelectedTarget) return
  if (autoConnectTimer) clearTimeout(autoConnectTimer)
  autoConnectTimer = setTimeout(() => {
    autoConnectTimer = null
    const targets = pobBridge?.getTargets() ?? []
    if (targets.length === 1) selectTarget(targets[0].pid)
  }, AUTO_CONNECT_DELAY)
}

function receivePids(args: string[]): void {
  if (hasSelectedTarget) return
  let receivedNewPid = false
  for (const arg of args) {
    const match = /^--pob-pid=(\d+)$/.exec(arg)
    if (!match) continue
    const pid = Number(match[1])
    if (Number.isSafeInteger(pid) && pid > 0 && !confirmedPids.has(pid)) {
      confirmedPids.add(pid)
      receivedNewPid = true
    }
  }
  if (receivedNewPid) scheduleAutoConnect()
  pobBridge?.refresh()
}

function selectTarget(pid: unknown): { target: { pid: number; buildName: string | null } } | { error: string } {
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0 || !pobBridge?.hasTarget(pid as number)) {
    return { error: '선택한 PoB 연결이 종료되었습니다.' }
  }
  if (hasSelectedTarget && selectedPid !== pid) {
    return { error: '연결된 PoB는 변경할 수 없습니다.' }
  }
  selectedPid = pid as number
  hasSelectedTarget = true
  if (autoConnectTimer) clearTimeout(autoConnectTimer)
  autoConnectTimer = null
  const target = pobBridge.getTargets().find((item) => item.pid === selectedPid)
  if (!target) return { error: '선택한 PoB 연결이 종료되었습니다.' }
  mainWindow?.webContents.send('pob:targets-changed', getRendererState())
  return { target: toRendererTarget(target) }
}

function toRendererTarget(target: PobTarget): { pid: number; buildName: string | null } {
  return { pid: target.pid, buildName: target.buildName }
}

function getRendererState(): { targets: { pid: number; buildName: string | null }[]; selectedPid: number | null } {
  return { targets: pobBridge?.getTargets().map(toRendererTarget) ?? [], selectedPid }
}

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'PoB Agent',
    width: 460,
    height: 540,
    minWidth: 360,
    minHeight: 360,
    backgroundColor: '#15171c',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#15171c',
      symbolColor: '#f2f3f5',
      height: 29,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = window
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function startAgent(): Promise<void> {
  try {
    watcherNative = loadWatcherNative()
    disconnectWatcher = connectToWatcher(watcherNative)
  } catch (error) {
    console.error('PoB watcher integration could not start:', error)
  }
  pobBridge = new PobBridgeService(
    app.getPath('userData'),
    (pid) => confirmedPids.has(pid) && (watcherNative?.listPobs().includes(pid) ?? false),
  )
  pobBridge.on('changed', (targets: PobTarget[]) => {
    const nextTargetPids = targets.map(({ pid }) => pid).sort((left, right) => left - right).join(',')
    if (nextTargetPids !== previousTargetPids) {
      previousTargetPids = nextTargetPids
      scheduleAutoConnect()
    }
    if (selectedPid !== null && !targets.some((target) => target.pid === selectedPid)) {
      const processExited = !pobBridge?.isProcessAlive(selectedPid)
      selectedPid = null
      if (processExited) app.quit()
    }
    mainWindow?.webContents.send('pob:targets-changed', getRendererState())
  })
  try {
    await pobBridge.start()
  } catch (error) {
    console.error('PoB bridge could not start:', error)
  }
  createWindow()
}

async function startWatcher(): Promise<void> {
  const native = loadWatcherNative()
  if (!native.isElevated()) throw new Error('PoB watcher requires administrator privileges')
  if (!native.acquireLock()) {
    app.quit()
    return
  }
  const watcher = new PobWatcher(native, app.getPath('userData'), (pids) => {
    const args = pids.map((pid) => `--pob-pid=${pid}`)
    if (!app.isPackaged) args.unshift(app.getAppPath())
    return native.launchAsUser(process.execPath, args)
  })
  app.on('before-quit', () => watcher.stop())
  await watcher.start()
}

if (process.argv.includes('--watcher')) {
  void app.whenReady().then(startWatcher).catch((error: unknown) => {
    console.error('PoB watcher failed:', error)
    app.quit()
  })
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  receivePids(process.argv)
  app.on('second-instance', (_event, args) => receivePids(args))
  void app.whenReady().then(startAgent).catch((error: unknown) => {
    console.error('PoB Agent failed:', error)
    app.quit()
  })
}
ipcMain.handle('pob:get-state', getRendererState)
ipcMain.handle('pob:select-target', (_event, pid: unknown) => selectTarget(pid))
app.on('before-quit', () => {
  if (autoConnectTimer) clearTimeout(autoConnectTimer)
  autoConnectTimer = null
  disconnectWatcher?.()
  void pobBridge?.stop()
})
app.on('window-all-closed', () => {
  if (!process.argv.includes('--watcher')) app.quit()
})
