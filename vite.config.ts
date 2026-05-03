import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, host: true, open: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Phaser's `load.svg` uses XHRLoader which expects data URIs to be
    // base64-encoded. Vite by default URL-encodes inlined SVGs (better
    // text compression) — that breaks Phaser's atob() call. Skip inlining
    // for SVG so they're served as external files instead, which Phaser
    // fetches and parses without issue.
    assetsInlineLimit: (filePath) => {
      if (filePath.endsWith('.svg')) return false;
      // Default 4 KiB threshold for everything else.
      return undefined;
    },
  },
});
