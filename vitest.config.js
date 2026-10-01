import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    // Run tests sequentially to avoid high CPU usage
    fileParallelism: false,
    // Use threads instead of forks for better performance
    pool: 'threads',
    // Limit to 2 workers max to reduce CPU load
    maxWorkers: 2,
    // Increase timeout for complex integration tests
    testTimeout: 30000,
    // Configure environment
    environment: 'node',
    // e2e specs use Playwright's runner — exclude them from vitest
    // `tmp*` files are ad-hoc diagnostics, not tests: they play hundreds of
    // turns to print telemetry and exhaust the heap (tmpEconDiag.test.ts says
    // so in its own header). Run them by hand when you need their output.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', '**/tmp*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})