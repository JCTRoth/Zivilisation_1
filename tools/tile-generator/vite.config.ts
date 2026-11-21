import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    watch: {
      // Generated output, not source: one run writes ~16k files under
      // tile_sets/ and this server watches its own root, so it walks the
      // whole tree until the system inotify limit is hit and dies with
      // `ENOSPC: System limit for number of file watchers reached`. Same for
      // the batch logs and the Python caches. The `**/` prefix matters:
      // chokidar is handed absolute paths, so a bare `tile_sets/**` would
      // never match. Merged with Vite's own defaults (node_modules, .git,
      // dist).
      ignored: ['**/tile_sets/**', '**/run_logs/**', '**/__pycache__/**'],
    },
    proxy: {
      '/api': { target: 'http://localhost:3456', changeOrigin: true },
    },
  },
});
