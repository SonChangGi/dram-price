import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const { verifyHtml } = createRequire(import.meta.url)('../scripts/design-contract/verify-design.cjs');

const root = fileURLToPath(new URL('.', import.meta.url));
const repositoryData = resolve(root, '../data');
const dataFiles = ['prices.json', 'series.json', 'status.json', 'summary.json', 'automation-health.json'] as const;

function firstPaintOrderPlugin(): Plugin {
  return {
    name: 'first-paint-order',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const shell = html.match(/<link\b[^>]*data-quant-design="0\.4\.4"[^>]*>/)?.[0];
        const stylesheet = html.match(/<link\b[^>]*data-quant-first-paint-css[^>]*>/)?.[0];
        const bootstrap = html.match(/<script\b[^>]*data-quant-design-project="dram-price"[^>]*><\/script>/)?.[0];
        if (!shell || !stylesheet || !bootstrap) throw new Error('Missing first-paint entry.');
        const entries = [...html.matchAll(/<script\b[^>]*type="module"[^>]*src="[^"]+"[^>]*><\/script>/g)].map((match) => match[0]);
        let ordered = html.replace(shell, '').replace(stylesheet, '').replace(bootstrap, '');
        entries.forEach((entry) => { ordered = ordered.replace(entry, ''); });
        ordered = ordered.replace('</head>', `${shell}\n${stylesheet}\n${bootstrap}\n${entries.join('\n')}\n</head>`);
        verifyHtml(ordered, { project: 'dram-price', navigation: 'react' });
        return ordered;
      },
    },
  };
}

function repositoryDataPlugin(): Plugin {
  return {
    name: 'repository-data',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const match = pathname.match(/\/(?:dram-price\/)?data\/([^/]+\.json)$/);
        const filename = match?.[1];
        if (!filename || !dataFiles.includes(filename as (typeof dataFiles)[number])) {
          next();
          return;
        }
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(readFileSync(resolve(repositoryData, basename(filename))));
      });
    },
    closeBundle() {
      const outputData = resolve(root, 'dist/data');
      mkdirSync(outputData, { recursive: true });
      dataFiles.forEach((filename) => copyFileSync(resolve(repositoryData, filename), resolve(outputData, filename)));
    },
  };
}

export default defineConfig({
  base: '/dram-price/',
  plugins: [react(), tailwindcss(), repositoryDataPlugin(), firstPaintOrderPlugin()],
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
