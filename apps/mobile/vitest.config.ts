import { defineConfig } from 'vitest/config';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    passWithNoTests: true,
  },
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // The RN runtime is not installed; screens render through a DOM shim.
      'react-native': path.join(dir, 'test/react-native-shim.tsx'),
    },
  },
});
