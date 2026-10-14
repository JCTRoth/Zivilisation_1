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
    // The game's starting language follows the browser, which here means the
    // machine's locale — pin it so assertions on English strings hold on every
    // dev box (see tests/setup.ts).
    setupFiles: ['./tests/setup.ts'],
    // e2e specs use Playwright's runner — exclude them from vitest.
    //
    // `tmp*.test.ts` is a NAMING CONVENTION for ad-hoc diagnostics, not tests:
    // probes that play hundreds of turns to print telemetry, write JSON to
    // /tmp, or assert nothing beyond `expect(true).toBe(true)`. They are
    // excluded so `npm test` cannot be held hostage by a probe that does not
    // terminate — which is exactly what happened before this rule earned its
    // keep. A file that asserts something belongs under a name that is not
    // `tmp*`, and stays in the suite.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', '**/tmp*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})