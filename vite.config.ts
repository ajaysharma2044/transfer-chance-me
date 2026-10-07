/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Local full-stack dev: the SPA runs on 5200 (`npm run dev -- --port 5200`)
    // while the Netlify functions run under `netlify dev` on 8888
    // (`npm run dev:full`). Proxy /api/* to 8888 so one URL (5200) exercises the
    // real backend — netlify dev's own proxy mangles Vite's React HMR preamble,
    // so we don't serve the app through 8888. Override with FUNCTIONS_ORIGIN.
    proxy: {
      '/api': {
        target: process.env.FUNCTIONS_ORIGIN || 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
  test: {
    // Claude Code checkouts live under .claude/worktrees/ and carry their own
    // copy of tests/. Without this exclude, vitest runs every copy: each
    // failure appears twice, and a STALE worktree fails the suite with tests
    // that no longer exist in the real tree — which is exactly what happened
    // when the audit consolidation landed.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
