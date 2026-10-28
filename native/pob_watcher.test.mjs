import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import test from 'node:test'
import watcher from '../build/Release/pob_watcher.node'

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail(typeof message === 'function' ? message() : message)
}

test('launches a process under the standard user token', { skip: !watcher.isElevated() }, async (context) => {
  const pid = watcher.launchAsUser(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'])
  context.after(() => { try { process.kill(pid) } catch {} })
  await new Promise((resolve) => setTimeout(resolve, 2000))
  assert.ok(watcher.isProcessAlive(pid), 'Standard user process exited immediately')
})

test('starts kernel tracing and enumerates PoB processes', { skip: !watcher.isElevated() }, async (context) => {
  assert.ok(watcher.acquireLock(), 'Another watcher is running in this session')
  const directory = join(tmpdir(), `pob-watcher-${randomUUID()}`)
  const executable = join(directory, 'Path of Building.exe')
  const setup = `const fs = require('node:fs'); fs.mkdirSync(${JSON.stringify(directory)}); fs.copyFileSync(process.env.ComSpec, ${JSON.stringify(executable)})`
  watcher.launchAsUser(process.execPath, ['-e', setup])
  await waitFor(() => existsSync(executable), 'Test executable was not created by standard user')
  context.after(async () => rm(directory, { recursive: true, force: true }))

  const events = []
  watcher.subscribe((event) => events.push(event))
  context.after(() => watcher.stop())
  await waitFor(
    () => events.filter((item) => item.type === 'resync').length >= 2,
    () => `Kernel tracing did not start: ${JSON.stringify(events)}`,
  )

  const child = spawn(executable, ['/d', '/c', 'ping -n 30 127.0.0.1 > nul'], { windowsHide: true })
  const childPid = child.pid
  context.after(() => child.kill())
  await waitFor(() => watcher.listPobs().includes(childPid), 'Test process was not listed as PoB')
  child.kill()
  await waitFor(() => !watcher.listPobs().includes(childPid), 'Test process remained listed as PoB after exit')
})
