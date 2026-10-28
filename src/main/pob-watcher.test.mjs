import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PobWatcher, watcherPipePath } from './pob-watcher.ts'

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail('Timed out waiting for watcher state')
}

test('passes the full first PID list and retains suppression through watcher restart', async (context) => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'pob-watcher-state-'))
  const sessionId = process.pid + 100000
  const pids = new Set([101, 102])
  const launches = []
  let notify = () => {}
  const native = {
    sessionId: () => sessionId,
    listPobs: () => [...pids],
    isProcessAlive: () => true,
    subscribe: (callback) => { notify = callback },
    stop: () => {},
  }
  const launch = (ids) => {
    launches.push(ids)
    return 20000 + launches.length
  }
  context.after(async () => rm(userDataPath, { recursive: true, force: true }))

  const first = new PobWatcher(native, userDataPath, launch)
  context.after(() => first.stop())
  await first.start()
  assert.deepEqual(launches, [[101, 102]])
  assert.equal(first.recoveryCheck, null)
  notify({ type: 'error', pid: 0x80041003, stage: 'start:Next' })
  assert.equal(first.recoveryCheck, null)
  notify({ type: 'resync', pid: 0, stage: 'start' })
  assert.equal(first.recoveryCheck, null)

  const agent = connect(watcherPipePath(sessionId))
  await once(agent, 'connect')
  agent.destroy()
  await once(agent, 'close')
  await new Promise((resolve) => setTimeout(resolve, 50))
  pids.add(103)
  notify({ type: 'start', pid: 103 })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual(launches, [[101, 102]])
  first.stop()

  const second = new PobWatcher(native, userDataPath, launch)
  context.after(() => second.stop())
  await second.start()
  assert.deepEqual(launches, [[101, 102]])

  pids.clear()
  notify({ type: 'stop', pid: 101 })
  await waitFor(() => second.recoveryCheck !== null)
  pids.add(104)
  notify({ type: 'start', pid: 104 })
  await waitFor(() => launches.length === 2)
  assert.deepEqual(launches[1], [104])
  assert.equal(second.recoveryCheck, null)
})

test('discovers a running PoB when its start event is missed', async (context) => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'pob-watcher-recovery-'))
  const pids = new Set()
  const launches = []
  const native = {
    sessionId: () => process.pid + 200000,
    listPobs: () => [...pids],
    isProcessAlive: () => true,
    subscribe: () => {},
    stop: () => {},
  }
  const watcher = new PobWatcher(native, userDataPath, (ids) => { launches.push(ids); return process.pid })
  context.after(async () => { watcher.stop(); await rm(userDataPath, { recursive: true, force: true }) })
  await watcher.start()
  pids.add(98765)
  for (let attempt = 0; attempt < 70 && !launches.length; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.deepEqual(launches, [[98765]])
  assert.equal(watcher.recoveryCheck, null)
})
