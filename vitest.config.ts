import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
    // PGlite WASM cold-start can push the first query past 5s on slower
    // machines or when several test files share parallelism. 20s gives
    // comfortable headroom without masking genuine hangs.
    testTimeout: 20_000,
  },
})
