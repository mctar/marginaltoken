import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const siteDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(siteDir, '../data')
const feedFiles = new Set(['prices.json', 'history.json', 'changes.json', 'meta.json', 'brief.json'])

function localFeed(): Plugin {
  return {
    name: 'marginal-token-local-feed',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const match = request.url?.match(/^\/data\/([^/?]+\.json)(?:\?.*)?$/)
        if (!match || !feedFiles.has(match[1])) {
          next()
          return
        }
        try {
          const body = await fs.readFile(path.join(dataDir, match[1]))
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(body)
        } catch {
          response.statusCode = 404
          response.end('Feed file not found')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localFeed()],
  base: '/',
})
