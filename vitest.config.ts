import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/lib/__test-stubs__/server-only.ts'),
    },
  },
  // tsconfig uses jsx:preserve for Next; Vitest 4 / Vite 8 use oxc (esbuild.jsx is ignored).
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'node',
  },
})
