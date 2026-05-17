import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let runDir: string
const CLI = new URL('../../bin/magpie.ts', import.meta.url).pathname

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-serve-'))
  await mkdir(join(runDir, 'screen'), { recursive: true })
  await mkdir(join(runDir, 'state'), { recursive: true })
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

test('serve prints server-info JSON to stdout and stays alive briefly', async () => {
  const proc = Bun.spawn(['bun', CLI, 'serve', runDir, '--idle-ms', '300'], { stdout: 'pipe' })
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  const start = Date.now()
  let buffer = ''
  while (Date.now() - start < 5000) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value)
    const newlineIdx = buffer.indexOf('\n')
    if (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx)
      const parsed = JSON.parse(line)
      expect(typeof parsed.url).toBe('string')
      expect(typeof parsed.port).toBe('number')
      expect(parsed.state_dir).toBe(join(runDir, 'state'))
      proc.kill()
      await proc.exited
      return
    }
  }
  proc.kill()
  throw new Error('did not receive server-info on stdout')
})
