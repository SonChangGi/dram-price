import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

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
const startupBase = 'https://sonchanggi.github.io/quant-dashboard/shared/design/startup/1.1.0/';
const startupCss = `${startupBase}dram-price.css`;
const startupJs = `${startupBase}start.js`;
const remoteAssets = [...index.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+\.(?:js|css))["']/g)].map((match) => match[1]);
if (remoteAssets.length !== 2 || !remoteAssets.includes(startupCss) || !remoteAssets.includes(startupJs)) {
  throw new Error('Production HTML must contain only the approved first-paint remote assets.');
}
const head = index.split('</head>')[0];
const startupTags = head.match(/<link\b[^>]*data-quant-first-paint-css[^>]*>\s*<script\b[^>]*data-quant-design-project="dram-price"[^>]*><\/script>\s*$/)?.[0];
if (!startupTags || /\b(?:async|defer|type\s*=)/.test(startupTags)) {
  throw new Error('First-paint stylesheet and blocking bootstrap must be last in the production head.');
}

const dataFiles = required.filter((file) => file.startsWith('dist/data/'));
for (const distPath of dataFiles) {
  const repositoryPath = `../${distPath.replace(/^dist\//, '')}`;
  const [repositoryBytes, distBytes] = await Promise.all([
    readFile(repositoryPath),
    readFile(distPath),
  ]);
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  if (digest(repositoryBytes) !== digest(distBytes)) {
    throw new Error(`${distPath} is not byte-identical to ${repositoryPath}.`);
  }
}

console.log(
  `Verified ${required.length} production artifacts, ${dataFiles.length} byte-identical JSON files, and the /dram-price/ base path.`,
);
