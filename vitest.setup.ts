import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Auto-cleanup between component tests. Necessary because Vitest's
// globals: false means @testing-library/react's auto-cleanup can't
// find afterEach on globalThis and won't self-register.
afterEach(() => {
  cleanup()
})
