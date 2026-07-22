import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repositoryData = resolve(root, '../data');
const dataFiles = ['prices.json', 'series.json', 'status.json', 'summary.json', 'automation-health.json'] as const;

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
  plugins: [react(), tailwindcss(), repositoryDataPlugin()],
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
