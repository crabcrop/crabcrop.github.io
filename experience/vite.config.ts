import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';
import { readFileSync } from 'node:fs';

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
      // The formats card quotes the real sizes of this page's own marina. The
      // script writes them in from the manifest once it runs; the page's
      // markup carries them too (for the moment before, and for a visitor
      // without scripts), and those are written here, from the same manifest,
      // so they cannot go stale when the pictures are encoded again.
      name: 'marina-sizes',
      transformIndexHtml(html) {
        const { avif, webp } = JSON.parse(readFileSync(`${media}/manifest.json`, 'utf8')).plates.z0.bytes['3200'];
        const kb = (n: number) => `${Math.round(n / 1024)} KB`;
        const was = /<b>AVIF \d+ KB<\/b> · <b>WebP \d+ KB<\/b>/;
        if (!was.test(html)) throw new Error('marina-sizes: the formats card was not found');
        return html.replace(was, `<b>AVIF ${kb(avif)}</b> · <b>WebP ${kb(webp)}</b>`);
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
