import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Multi-page build: every tool is its OWN indexable page (SEO is the
// bloodstream of .Com — the opposite of .Me's noindex lock).
export default defineConfig({
  // GitHub Pages serves from /<repo>/ unless a custom domain is set.
  // With the AnotherPart.Com domain attached this becomes '/'.
  base: '/',
  // Pre-bundle phonemize with esbuild — its ESM build imports .json without
  // attributes, which trips Vite's on-the-fly transform; esbuild inlines the
  // dictionaries cleanly so `toIPA` works in the browser.
  optimizeDeps: {
    include: ['phonemize']
  },
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        translate: resolve(__dirname, 'translate/index.html'),
        translateTurn: resolve(__dirname, 'translate/turn/index.html'),
        translateTurnOffline: resolve(
          __dirname,
          'translate/turn-offline/index.html'
        ),
        translateTurnStream: resolve(
          __dirname,
          'translate/turn-stream/index.html'
        ),
        translateTurnOfflineSmall: resolve(
          __dirname,
          'translate/turn-offline-small/index.html'
        ),
        translateDuplex: resolve(
          __dirname,
          'translate/duplex/index.html'
        ),
        translateDuplexBase: resolve(
          __dirname,
          'translate/duplex-base/index.html'
        ),
        translateDuplexSmall: resolve(
          __dirname,
          'translate/duplex-small/index.html'
        ),
        transcribe: resolve(__dirname, 'transcribe/index.html'),
        transcribeNotes: resolve(
          __dirname,
          'transcribe/notes/index.html'
        ),
        transcribeLive: resolve(
          __dirname,
          'transcribe/live/index.html'
        ),
        sky: resolve(__dirname, 'sky/index.html')
      }
    }
  }
});
