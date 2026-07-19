import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Multi-page build: every tool is its OWN indexable page (SEO is the
// bloodstream of .Com — the opposite of .Me's noindex lock).
export default defineConfig({
  // GitHub Pages serves from /<repo>/ unless a custom domain is set.
  // With the AnotherPart.Com domain attached this becomes '/'.
  base: '/',
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        translate: resolve(__dirname, 'translate/index.html'),
        translateTurn: resolve(__dirname, 'translate/turn/index.html')
      }
    }
  }
});
