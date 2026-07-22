import { access, readFile } from 'node:fs/promises';

const required = [
  'dist/index.html',
  'dist/data/prices.json',
  'dist/data/series.json',
  'dist/data/status.json',
  'dist/data/summary.json',
  'dist/data/automation-health.json',
];

await Promise.all(required.map((file) => access(file)));
const index = await readFile('dist/index.html', 'utf8');
if (!index.includes('/dram-price/assets/')) {
  throw new Error('Vite base path was not applied to the production assets.');
}
if (/https?:\/\/[^"']+\.(?:js|css)/.test(index)) {
  throw new Error('Production HTML unexpectedly depends on a remote JS/CSS asset.');
}
console.log(`Verified ${required.length} production artifacts and the /dram-price/ base path.`);
