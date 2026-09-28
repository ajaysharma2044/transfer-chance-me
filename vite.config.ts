/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Claude Code checkouts live under .claude/worktrees/ and carry their own
    // copy of tests/. Without this exclude, vitest runs every copy: each
    // failure appears twice, and a STALE worktree fails the suite with tests
    // that no longer exist in the real tree — which is exactly what happened
    // when the audit consolidation landed.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
