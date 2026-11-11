import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';

// Code builds into ../preview/dive next to the media the encode scripts
// write there; the build never empties that folder.
const media = fileURLToPath(new URL('../preview/dive/media', import.meta.url));

export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: '../preview/dive',
    emptyOutDir: false,
    assetsDir: 'assets',
    target: 'es2020',
    modulePreload: { polyfill: false },
  },
  server: { fs: { allow: ['..'] } },
  plugins: [
    {
      name: 'serve-media',
      configureServer(server) {
        server.middlewares.use('/media', sirv(media, { dev: true }));
      },
    },
  ],
});
