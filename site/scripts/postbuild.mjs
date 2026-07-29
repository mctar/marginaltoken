import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const siteDir = path.dirname(scriptsDir)
const rootDir = path.dirname(siteDir)
const distDir = path.join(siteDir, 'dist')

await cp(path.join(rootDir, 'data'), path.join(distDir, 'data'), { recursive: true })
await copyFile(path.join(rootDir, 'CNAME'), path.join(distDir, 'CNAME'))
await writeFile(path.join(distDir, '.nojekyll'), '')

for (const route of ['tape', 'methodology']) {
  const routeDir = path.join(distDir, route)
  await mkdir(routeDir, { recursive: true })
  await copyFile(path.join(distDir, 'index.html'), path.join(routeDir, 'index.html'))
}

await copyFile(path.join(distDir, 'index.html'), path.join(distDir, '404.html'))
