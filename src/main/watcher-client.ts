import { app } from 'electron'
import { watcherPipePath } from './pob-watcher'
import type { WatcherNative } from './watcher-native'

export function connectToWatcher(native: WatcherNative): () => void {
  let stopped = false
  let connected = false
  let attemptedLaunch = false
  let retry: ReturnType<typeof setTimeout> | null = null
  const pipePath = watcherPipePath(native.sessionId())

  function open(): void {
    if (stopped) return
    try {
      if (connected && !native.isWatcherPipeConnected()) connected = false
      if (!connected) {
        connected = native.openWatcherPipe(pipePath)
        if (connected) {
          attemptedLaunch = false
        } else if (!attemptedLaunch) {
          attemptedLaunch = true
          const args = app.isPackaged ? ['--watcher'] : [app.getAppPath(), '--watcher']
          native.launchElevated(process.execPath, args)
        }
      }
    } catch (error) {
      console.error('PoB watcher connection failed:', error)
    }
    retry = setTimeout(open, 1000)
  }

  open()
  return () => {
    stopped = true
    if (retry) clearTimeout(retry)
    native.closeWatcherPipe()
  }
}
