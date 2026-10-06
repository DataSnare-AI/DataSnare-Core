import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(process.argv[2] || resolve(coreRoot, '..', 'DataSnare-AINetScope'));
const destinationRoot = resolve(coreRoot, 'public', 'ainetscope');
const assets = [
  'analysis-worker.js',
  'app.js',
  'batch.js',
  'capacity-check.js',
  'expert.js',
  'flow-detail.js',
  'index.html',
  'packet-workbench.js',
  'tcp-signals.js',
  'workbench-layout.js',
  'process-map.js',
  'set-analysis-worker.js',
  'styles.css',
  'topology-window.js',
  'tuning.js',
  'watch.js',
  'two-sided-match.js',
  'two-sided.js',
  'two-sided-analytics.js',
  'two-sided-dashboard.js',
  'capture-launch.js',
  'session-contract.js',
  'sessions.js',
];

await mkdir(destinationRoot, { recursive: true });
for (const asset of assets) {
  await copyFile(resolve(sourceRoot, asset), resolve(destinationRoot, asset));
}
console.log(`Synced ${assets.length} AINetScope assets from ${sourceRoot} to public/ainetscope.`);