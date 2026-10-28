import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: 'webview',
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^zod$/,
        replacement: fileURLToPath(new URL('./webview/validationRuntime.ts', import.meta.url)),
      },
    ],
  },
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: 'assets/app.js', assetFileNames: 'assets/[name][extname]' },
    },
  },
});
