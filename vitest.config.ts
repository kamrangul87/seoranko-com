import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './src/lib/__test-stubs__/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
  },
})
