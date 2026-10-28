import { createServer, type Server, type Socket } from 'node:net'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WatcherNative } from './watcher-native'

export function watcherPipePath(sessionId: number): string {
  return `\\\\.\\pipe\\pob-agent-watcher-${sessionId}`
}

export class PobWatcher {
  private readonly native: WatcherNative
  private readonly launchAgent: (pids: number[]) => number
  private readonly markerPath: string
  private readonly sockets = new Set<Socket>()
  private readonly launchChecks = new Set<ReturnType<typeof setInterval>>()
  private readonly active = new Set<number>()
  private readonly delivered = new Set<number>()
  private readonly failedSubscriptions = new Set<string>()
  private server: Server | null = null
  private queue: Promise<void> = Promise.resolve()
  private suppressed = false
  private markerExists = false
  private initialized = false
  private recoveryCheck: ReturnType<typeof setInterval> | null = null

  constructor(
    native: WatcherNative,
    userDataPath: string,
    launchAgent: (pids: number[]) => number,
  ) {
    this.native = native
    this.launchAgent = launchAgent
    this.markerPath = join(userDataPath, 'pob-watcher-state.json')
  }

  async start(): Promise<void> {
    const server = createServer((socket) => {
      this.sockets.add(socket)
      this.enqueue(async () => {
        this.suppressed = false
        await this.saveMarker()
        await this.dispatch([...this.active].filter((pid) => !this.delivered.has(pid)))
      })
      socket.on('close', () => {
        this.sockets.delete(socket)
        if (this.sockets.size) return
        this.enqueue(async () => {
          this.delivered.clear()
          this.suppressed = this.active.size > 0
          await this.saveMarker()
        })
      })
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(watcherPipePath(this.native.sessionId()), () => {
        server.off('error', reject)
        resolve()
      })
    })
    server.on('error', (error) => console.error('PoB watcher pipe failed:', error))
    this.native.subscribe((event) => {
      if (event.type === 'error') {
        console.error('PoB process event subscription interrupted; retrying:', event.stage, event.pid.toString(16))
        const source = event.stage?.split(':', 1)[0]
        if (source === 'start' || source === 'stop') this.failedSubscriptions.add(source)
        if (!this.recoveryCheck) this.recoveryCheck = setInterval(() => this.enqueue(() => this.resync()), 5000)
        return
      }
      if (event.type === 'resync') {
        this.failedSubscriptions.delete(event.stage ?? '')
        if (!this.failedSubscriptions.size && this.recoveryCheck) {
          clearInterval(this.recoveryCheck)
          this.recoveryCheck = null
        }
      }
      this.enqueue(() => this.resync())
    })
    this.enqueue(() => this.resync())
    await this.queue
  }

  stop(): void {
    this.native.stop()
    if (this.recoveryCheck) clearInterval(this.recoveryCheck)
    this.recoveryCheck = null
    for (const check of this.launchChecks) clearInterval(check)
    this.launchChecks.clear()
    for (const socket of this.sockets) socket.destroy()
    this.server?.close()
    this.server = null
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => console.error('PoB watcher update failed:', error))
  }

  private async resync(): Promise<void> {
    const next = new Set(this.native.listPobs())
    if (!this.initialized) {
      this.initialized = true
      try {
        const previous = JSON.parse(await readFile(this.markerPath, 'utf8')) as { pids?: number[] }
        this.markerExists = true
        this.suppressed = Array.isArray(previous.pids) && previous.pids.some((pid) => next.has(pid))
      } catch {
        this.markerExists = false
      }
    }
    this.active.clear()
    for (const pid of next) this.active.add(pid)
    for (const pid of this.delivered) if (!next.has(pid)) this.delivered.delete(pid)
    if (!next.size) {
      this.suppressed = false
      this.delivered.clear()
    }
    if (!this.suppressed || this.sockets.size) {
      await this.dispatch([...next].filter((pid) => !this.delivered.has(pid)))
    }
    if (this.markerExists) await this.saveMarker()
  }

  private async dispatch(pids: number[]): Promise<void> {
    if (!pids.length) return
    for (const pid of pids) this.delivered.add(pid)
    this.markerExists = true
    await this.saveMarker()
    let agentPid: number
    try {
      agentPid = this.launchAgent(pids)
    } catch (error) {
      for (const pid of pids) this.delivered.delete(pid)
      if (!this.sockets.size) {
        await rm(this.markerPath, { force: true })
        this.markerExists = false
      }
      throw error
    }
    if (!this.sockets.size) {
      const check = setInterval(() => {
        if (this.sockets.size || !this.active.size) {
          clearInterval(check)
          this.launchChecks.delete(check)
          return
        }
        if (this.native.isProcessAlive(agentPid)) return
        clearInterval(check)
        this.launchChecks.delete(check)
        this.enqueue(async () => {
          this.suppressed = true
          this.delivered.clear()
          await this.saveMarker()
        })
      }, 500)
      this.launchChecks.add(check)
    }
  }

  private async saveMarker(): Promise<void> {
    if (!this.active.size) {
      await rm(this.markerPath, { force: true })
      this.markerExists = false
      return
    }
    this.markerExists = true
    const temporaryPath = `${this.markerPath}.tmp`
    await writeFile(temporaryPath, JSON.stringify({ pids: [...this.active] }))
    await rename(temporaryPath, this.markerPath)
  }
}
