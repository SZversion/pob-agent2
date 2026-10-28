import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
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
  const resultPath = join(tmpdir(), `pob-token-result-${randomUUID()}.txt`)
  const addon = join(process.cwd(), 'build/Release/pob_watcher.node')
  const script = `const fs=require('node:fs');const n=require(${JSON.stringify(addon)});fs.writeFileSync(${JSON.stringify(resultPath)},String(n.isElevated()));setTimeout(()=>{},30000)`
  const pid = watcher.launchAsUser(process.execPath, ['-e', script])
  context.after(() => { try { process.kill(pid) } catch {} })
  context.after(() => rm(resultPath, { force: true }))
  await waitFor(() => existsSync(resultPath), 'Standard user process did not report its token state')
  assert.equal(await readFile(resultPath, 'utf8'), 'false')
  assert.ok(watcher.isProcessAlive(pid), 'Standard user process exited immediately')
})

test('connects a standard user to an elevated watcher pipe', { skip: !watcher.isElevated() }, async (context) => {
  const pipe = `\\\\.\\pipe\\pob-agent-pipe-test-${process.pid}`
  const resultPath = join(tmpdir(), `pob-pipe-result-${randomUUID()}.json`)
  let connected = false
  let disconnected = false
  const server = createServer((socket) => {
    connected = true
    socket.on('close', () => { disconnected = true })
    socket.on('error', () => {})
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve) })
  context.after(async () => { server.close(); await rm(resultPath, { force: true }) })
  const addon = join(process.cwd(), 'build/Release/pob_watcher.node')
  const script = `const fs=require('node:fs');let result;try{const n=require(${JSON.stringify(addon)});result={opened:n.openWatcherPipe(${JSON.stringify(pipe)}),alive:n.isWatcherPipeConnected()};n.closeWatcherPipe()}catch(e){result={error:e.message}}fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(result))`
  watcher.launchAsUser(process.execPath, ['-e', script])
  await waitFor(() => existsSync(resultPath), 'Standard user did not finish the pipe test')
  assert.deepEqual(JSON.parse(await readFile(resultPath, 'utf8')), { opened: true, alive: true })
  await waitFor(() => connected && disconnected, 'Watcher did not observe the standard user connection and exit')
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
