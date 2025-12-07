import { defineConfig } from 'vitest/config'
import path from 'path'

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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})