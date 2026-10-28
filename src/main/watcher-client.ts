import { connect, type Socket } from 'node:net'
import { app } from 'electron'
import { watcherPipePath } from './pob-watcher'
import type { WatcherNative } from './watcher-native'

export function connectToWatcher(native: WatcherNative): () => void {
  let stopped = false
  let socket: Socket | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let attemptedLaunch = false
  const pipePath = watcherPipePath(native.sessionId())

  function open(): void {
    if (stopped) return
    socket = connect(pipePath)
    socket.on('error', () => {})
    socket.on('connect', () => { attemptedLaunch = false })
    socket.on('close', () => {
      socket = null
      if (stopped) return
      if (!attemptedLaunch) {
        attemptedLaunch = true
        const args = app.isPackaged ? ['--watcher'] : [app.getAppPath(), '--watcher']
        try {
          native.launchElevated(process.execPath, args)
        } catch (error) {
          console.error('PoB watcher could not start:', error)
        }
      }
      retry = setTimeout(open, 1000)
    })
  }

  open()
  return () => {
    stopped = true
    if (retry) clearTimeout(retry)
    socket?.destroy()
  }
}
