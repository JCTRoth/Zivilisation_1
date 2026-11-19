import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Dev-server middleware that persists structured game-log lines to disk.
 *
 * The browser cannot write to the filesystem, so the GameLogger utility
 * POSTs batched JSON lines to `/__game_log`; this plugin appends them to
 * `game-logs/<sessionId>.log` on the host.
 */
function gameLogPlugin() {
  return {
    name: 'game-log-writer',
    configureServer(server) {
      server.middlewares.use('/__game_log', (req, res, next) => {
        // GET /__game_log?session=<sessionId> returns the full persisted log
        // for that session as a JSON array (used by the progression exporter).
        if (req.method === 'GET') {
          const url = new URL(req.url, 'http://localhost')
          const session = String(url.searchParams.get('session') || 'game').replace(/[^a-zA-Z0-9._-]/g, '_')
          const file = join(process.cwd(), 'game-logs', `${session}.log`)
          res.setHeader('Content-Type', 'application/json')
          if (existsSync(file)) {
            const entries = readFileSync(file, 'utf8')
              .split('\n')
              .filter(Boolean)
              .map((l) => { try { return JSON.parse(l) } catch { return null } })
              .filter(Boolean)
            res.statusCode = 200
            res.end(JSON.stringify(entries))
          } else {
            res.statusCode = 404
            res.end(JSON.stringify({ ok: false, error: 'no log for session' }))
          }
          return
        }
        if (req.method !== 'POST') return next()
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body)
            const sessionId = String(payload.sessionId || 'game').replace(/[^a-zA-Z0-9._-]/g, '_')
            const dir = join(process.cwd(), 'game-logs')
            mkdirSync(dir, { recursive: true })
            const file = join(dir, `${sessionId}.log`)
            const lines = Array.isArray(payload.lines)
              ? payload.lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
              : ''
            appendFileSync(file, lines, 'utf8')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, file }))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: String(err) }))
          }
        })
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  // The app lives in the `web` workspace; shared/ and server/ are outside it.
  root: 'packages/web',
  // Keep the generated tile assets where the tile-generator tools expect them.
  publicDir: join(__dirname, 'public'),
  plugins: [react(), gameLogPlugin()],
  server: {
    host: true,
    port: 3000,
  },
  build: {
    // Relative to `root` (packages/web) → repository dist/.
    outDir: '../../dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@shared': join(__dirname, 'packages/shared'),
      '@': join(__dirname, 'packages/web/src'),
    },
  },
})