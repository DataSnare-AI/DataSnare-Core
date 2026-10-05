import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = { aiprocmon: 'DataSnare-AIProcMon', aiperf: 'DataSnare-AIPerf' };
const selected = process.argv[2] ? [process.argv[2]] : Object.keys(tools);
for (const toolId of selected) {
  if (!tools[toolId]) throw new Error(`Unknown static tool: ${toolId}`);
  const source = resolve(root, '..', tools[toolId]);
  const destination = resolve(root, 'public', toolId);
  await mkdir(resolve(destination, 'tools'), { recursive: true });
  const converter = toolId === 'aiprocmon' ? 'Convert-ProcMon.ps1' : 'Convert-PerfMon.ps1';
  for (const asset of ['index.html', 'app.js', 'styles.css', 'datasnare-core-context.js', `tools/${converter}`, 'tools/Conversion-Instructions.md']) {
    await copyFile(resolve(source, asset), resolve(destination, asset));
  }
  console.log(`Synced ${tools[toolId]} into public/${toolId}.`);
}