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
    {
      // The first view's fonts are asked for from the head: left alone they
      // are found only once the stylesheet is in. And the page's own script
      // is marked as wanted early (a module script is otherwise fetched at
      // low priority): it is what starts everything else. (The world's own
      // first files are asked for by that script, once the text has had its
      // first paint: see early() in src/main.ts.)
      name: 'first-view',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          const fonts = Object.values(ctx.bundle ?? {}).filter((c) => c.fileName.endsWith('.woff2'));
          const entry = '<script type="module" crossorigin src=';
          if (html.split(entry).length !== 2) throw new Error('first-view: the page script tag was not found');
          if (fonts.length !== 3) throw new Error(`first-view: expected the three fonts, found ${fonts.length}`);
          const early = [
            ...fonts.map((f) => `<link rel="preload" as="font" type="font/woff2" href="./${f.fileName}" crossorigin>`),
            '<script type="module" crossorigin fetchpriority="high" src=',
          ].join('\n');
          return html.replace(entry, () => early);
        },
      },
    },
  ],
});
