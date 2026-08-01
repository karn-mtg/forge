import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, 'vitest.setup.ts')],
    include: ['src/renderer/**/*.test.{ts,tsx}', 'db/**/*.test.js'],
  },
});
