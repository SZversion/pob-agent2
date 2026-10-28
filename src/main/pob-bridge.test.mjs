import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PobBridgeService } from './pob-bridge.ts'

test('tracks per-PID state-file changes and removes deleted targets', async (context) => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'pob-bridge-'))
  const stateDirectory = join(userDataPath, 'pob-bridge')
  let confirmed = false
  const bridge = new PobBridgeService(userDataPath, (pid) => confirmed && pid === process.pid)
  context.after(async () => {
    await bridge.stop()
    await rm(userDataPath, { recursive: true, force: true })
  })

  await bridge.start()
  const statePath = join(stateDirectory, `${process.pid}.json`)
  await writeFile(statePath, JSON.stringify({ pid: process.pid, buildPath: null }))
  await assert.rejects(once(bridge, 'changed', { signal: AbortSignal.timeout(200) }), { name: 'AbortError' })
  assert.deepEqual(bridge.getTargets(), [])

  confirmed = true
  const added = once(bridge, 'changed', { signal: AbortSignal.timeout(1500) })
  bridge.refresh()
  await added
  assert.deepEqual(bridge.getTargets(), [{ pid: process.pid, buildPath: null, buildName: null }])

  const buildPath = join(userDataPath, 'sample.xml')
  await writeFile(buildPath, '<build />')
  const updated = once(bridge, 'changed', { signal: AbortSignal.timeout(1500) })
  const tempStatePath = `${statePath}.tmp`
  await writeFile(tempStatePath, JSON.stringify({ pid: process.pid, buildPath }))
  await rename(tempStatePath, statePath)
  await updated
  assert.deepEqual(bridge.getTargets(), [{ pid: process.pid, buildPath, buildName: 'sample' }])

  await writeFile(buildPath, '<build changed="true" />')
  await assert.rejects(once(bridge, 'changed', { signal: AbortSignal.timeout(200) }), { name: 'AbortError' })

  const removed = once(bridge, 'changed', { signal: AbortSignal.timeout(1500) })
  await rm(statePath)
  await removed
  assert.deepEqual(bridge.getTargets(), [])
})
