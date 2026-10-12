import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  test: {
    fileParallelism: false, pool: 'threads', maxWorkers: 1, testTimeout: 1800000,
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
