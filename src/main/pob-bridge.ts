import { constants, watch, type FSWatcher } from 'node:fs'
import { access as accessFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { EventEmitter } from 'node:events'

export type PobTarget = {
  pid: number
  buildPath: string | null
  buildName: string | null
}

type BridgeState = {
  pid: number
  buildPath: string | null
}

export class PobBridgeService extends EventEmitter {
  private readonly stateDirectory: string
  private watcher: FSWatcher | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private watcherRetryTimer: ReturnType<typeof setTimeout> | null = null
  private processCheck: ReturnType<typeof setInterval> | null = null
  private readonly targets = new Map<number, PobTarget>()

  constructor(userDataPath: string) {
    super()
    this.stateDirectory = join(userDataPath, 'pob-bridge')
  }

  async start(): Promise<void> {
    if (this.watcher) return

    await mkdir(this.stateDirectory, { recursive: true })
    const watcher = watch(this.stateDirectory, () => this.scheduleRefresh())
    this.watcher = watcher
    watcher.on('error', (error) => {
      if (this.watcher !== watcher) return
      console.error('PoB state watcher failed:', error)
      watcher.close()
      this.watcher = null
      this.watcherRetryTimer = setTimeout(() => {
        this.watcherRetryTimer = null
        void this.start().catch((retryError: unknown) => console.error('PoB state watcher restart failed:', retryError))
      }, 1000)
    })
    await this.refreshTargets()
    this.processCheck ??= setInterval(() => this.removeExitedTargets(), 1000)
  }

  getTargets(): PobTarget[] {
    return [...this.targets.values()]
  }

  hasTarget(pid: number): boolean {
    return this.targets.has(pid)
  }

  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = null
    if (this.watcherRetryTimer) clearTimeout(this.watcherRetryTimer)
    this.watcherRetryTimer = null
    if (this.processCheck) clearInterval(this.processCheck)
    this.processCheck = null
    this.watcher?.close()
    this.watcher = null
    this.targets.clear()
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refreshTargets().catch((error: unknown) => console.error('PoB state refresh failed:', error))
    }, 50)
  }

  private async refreshTargets(): Promise<void> {
    const nextTargets = new Map<number, PobTarget>()
    const files = await readdir(this.stateDirectory)
    for (const file of files) {
      const match = /^(\d+)\.json$/.exec(file)
      if (!match) continue
      const pid = Number(match[1])
      if (!Number.isSafeInteger(pid) || pid <= 0) continue

      const statePath = join(this.stateDirectory, file)
      let state: unknown
      try {
        state = JSON.parse(await readFile(statePath, 'utf8')) as unknown
      } catch {
        continue
      }
      if (!state || typeof state !== 'object') continue
      const bridgeState = state as Partial<BridgeState>
      if (bridgeState.pid !== pid || (bridgeState.buildPath !== null && typeof bridgeState.buildPath !== 'string')) continue
      if (!this.isProcessAlive(pid)) {
        await rm(statePath, { force: true })
        continue
      }

      const buildPath = await this.readableBuildPath(bridgeState.buildPath ?? null)
      nextTargets.set(pid, {
        pid,
        buildPath,
        buildName: buildPath ? basename(buildPath, '.xml') : null,
      })
    }

    const changed = this.haveTargetsChanged(nextTargets)
    this.targets.clear()
    for (const [pid, target] of nextTargets) this.targets.set(pid, target)
    if (changed) this.emit('changed', this.getTargets())
  }

  private removeExitedTargets(): void {
    let changed = false
    for (const [pid] of this.targets) {
      if (this.isProcessAlive(pid)) continue
      this.targets.delete(pid)
      void rm(join(this.stateDirectory, `${pid}.json`), { force: true }).catch((error: unknown) =>
        console.error('Stale PoB state file could not be removed:', error),
      )
      changed = true
    }
    if (changed) this.emit('changed', this.getTargets())
  }

  private haveTargetsChanged(nextTargets: Map<number, PobTarget>): boolean {
    if (nextTargets.size !== this.targets.size) return true
    for (const [pid, next] of nextTargets) {
      const current = this.targets.get(pid)
      if (!current || current.buildPath !== next.buildPath || current.buildName !== next.buildName) return true
    }
    return false
  }

  private async readableBuildPath(path: string | null): Promise<string | null> {
    if (!path || !path.toLowerCase().endsWith('.xml')) return null
    try {
      await accessFile(path, constants.R_OK)
      if (!(await stat(path)).isFile()) return null
      return path
    } catch {
      return null
    }
  }
}
