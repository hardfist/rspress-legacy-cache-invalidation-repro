import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageRoot = path.join(root, 'node_modules', '@rspress', 'core');
const packageJson = JSON.parse(
  await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'),
);
const bin =
  typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin.rspress;
const cli = path.join(packageRoot, bin);
const fixed = process.argv.includes('--fixed');
const probeDirectory = path.join(root, '.probe');
const probeFile = path.join(probeDirectory, 'loader-runs.jsonl');

await fs.rm(path.join(root, '.cache'), { recursive: true, force: true });
await fs.rm(path.join(root, 'doc_build'), { recursive: true, force: true });
await fs.rm(probeDirectory, { recursive: true, force: true });
await fs.mkdir(probeDirectory, { recursive: true });

function build(label) {
  process.stdout.write(`\n===== ${label} =====\n`);
  const result = spawnSync(process.execPath, [cli, 'build'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      RSPRESS_CACHE_PROBE_BUILD: label,
      RSPRESS_CACHE_PROBE_FILE: probeFile,
      RSPRESS_CACHE_PROBE_FIXED: fixed ? 'true' : 'false',
    },
  });

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`Rspress build failed with status ${result.status}`);
  }
  return result.stdout;
}

build('cold build');
const coldRuns = (await fs.readFile(probeFile, 'utf8'))
  .trim()
  .split('\n')
  .filter(Boolean).length;

build('warm build in a new process');
const runs = (await fs.readFile(probeFile, 'utf8'))
  .trim()
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line));
const warmRuns = runs.filter(run => run.build === 'warm build in a new process');

if (coldRuns === 0) {
  throw new Error('The probe MDX loader did not run during the cold build');
}
if (fixed && warmRuns.length !== 0) {
  throw new Error(`Expected a warm cache hit, but MDX ran ${warmRuns.length} time(s)`);
}
if (!fixed && warmRuns.length === 0) {
  throw new Error('Expected a warm cache miss, but the MDX loader was restored');
}

process.stdout.write(
  fixed
    ? `\nPASS: cache: true restored ${coldRuns} MDX loader result(s); warm executions: 0.\n`
    : `\nPASS: MDX loader warm executions: ${warmRuns.length} (persistent-cache miss).\n`,
);
