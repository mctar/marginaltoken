import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = new URL('../../', import.meta.url)
const tests = readdirSync(new URL('../tests/', import.meta.url))
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
  .map((file) => fileURLToPath(new URL('../tests/' + file, import.meta.url)))
const loader = Number.parseInt(process.versions.node, 10) >= 24
  ? []
  : ['--loader', fileURLToPath(new URL('./test-loader.mjs', import.meta.url))]
const result = spawnSync(process.execPath, [...loader, '--test', ...tests], {
  cwd: fileURLToPath(root), stdio: 'inherit',
})
if (result.error) { console.error(result.error.message); process.exit(1) }
process.exit(result.status ?? 1)
