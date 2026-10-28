import { app } from 'electron'
import { join } from 'node:path'

export type ProcessEvent = { type: 'start' | 'stop' | 'resync' | 'error'; pid: number; stage?: string }

export type WatcherNative = {
  acquireLock(): boolean
  sessionId(): number
  isElevated(): boolean
  isProcessAlive(pid: number): boolean
  launchAsUser(executable: string, args: string[]): number
  launchElevated(executable: string, args: string[]): void
  listPobs(): number[]
  subscribe(callback: (event: ProcessEvent) => void): void
  stop(): void
}

export function loadWatcherNative(): WatcherNative {
  const modulePath = app.isPackaged
    ? join(process.resourcesPath, 'native', 'pob_watcher.node')
    : join(__dirname, '../../build/Release/pob_watcher.node')
  return require(modulePath) as WatcherNative
}
