import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docs = path.join(root, 'docs');
const rspressPackageRoot = path.join(root, 'node_modules', '@rspress', 'core');
const rspressPackage = JSON.parse(
  await fs.readFile(path.join(rspressPackageRoot, 'package.json'), 'utf8'),
);
const rspressBin =
  typeof rspressPackage.bin === 'string'
    ? rspressPackage.bin
    : rspressPackage.bin.rspress;
const rspressCli = path.join(rspressPackageRoot, rspressBin);
const requested = process.argv[2] ?? 'all';
const variants =
  requested === 'all' ? ['legacy', 'new-full'] : requested.split(',');
const supported = new Set(['legacy', 'new-full']);

if (variants.some(variant => !supported.has(variant))) {
  throw new Error(
    'Usage: node scripts/benchmark.mjs <all|legacy|new-full|comma-separated variants>',
  );
}

const mdxFiles = (await fs.readdir(docs))
  .filter(entry => /\.mdx?$/.test(entry))
  .map(entry => path.join(docs, entry));

function parseRspressTime(output) {
  const match = output.match(/built in ([\d.]+)(ms|s)/);
  return match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : null;
}

function runBuild(variant, cacheDirectory, label) {
  const start = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [rspressCli, 'build'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      RSPRESS_BENCH_VARIANT: variant,
      RSPRESS_BENCH_CACHE_DIR: cacheDirectory,
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6;

  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${variant} ${label} failed with status ${result.status}`);
  }

  const measurement = {
    label,
    rspressMs: parseRspressTime(result.stdout),
    wallMs: Number(wallMs.toFixed(2)),
  };
  process.stderr.write(
    `${variant.padEnd(10)} ${label.padEnd(12)} ${String(measurement.rspressMs).padStart(6)} ms (${measurement.wallMs.toFixed(2)} ms wall)\n`,
  );
  return measurement;
}

async function touchMdx() {
  const now = new Date();
  await Promise.all(mdxFiles.map(file => fs.utimes(file, now, now)));
}

async function directorySize(directory) {
  let size = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      size += await directorySize(target);
    } else if (entry.isFile()) {
      size += (await fs.stat(target)).size;
    }
  }
  return size;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function createCacheDirectory(variant, sample) {
  const cacheRoot = path.join(root, '.benchmark', 'cache');
  await fs.mkdir(cacheRoot, { recursive: true });
  return fs.mkdtemp(path.join(cacheRoot, `${variant}-${sample}-`));
}

async function runVariant(variant) {
  const warmCacheDirectory = await createCacheDirectory(variant, 'warm');
  const measurements = [
    runBuild(variant, warmCacheDirectory, 'cold-warm'),
    runBuild(variant, warmCacheDirectory, 'warm-1'),
  ];

  const touchCacheDirectory = await createCacheDirectory(variant, 'touch');
  measurements.push(runBuild(variant, touchCacheDirectory, 'cold-touch'));
  await touchMdx();
  measurements.push(runBuild(variant, touchCacheDirectory, 'touch-1'));

  const warm = measurements
    .filter(item => item.label.startsWith('warm-'))
    .map(item => item.rspressMs);
  const touch = measurements
    .filter(item => item.label.startsWith('touch-'))
    .map(item => item.rspressMs);

  return {
    variant,
    cacheDirectories: {
      warm: path.relative(root, warmCacheDirectory),
      touch: path.relative(root, touchCacheDirectory),
    },
    cacheBytes: await directorySize(warmCacheDirectory),
    medians: {
      warmRspressMs: median(warm),
      touchRspressMs: median(touch),
    },
    measurements,
  };
}

const startedAt = new Date().toISOString();
const results = [];
for (const variant of variants) {
  results.push(await runVariant(variant));
}

const report = {
  startedAt,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  rspress: rspressPackage.version,
  rspack: '2.2.0-canary-12bde9b1-20260824102525',
  pages: mdxFiles.length,
  results,
};
const resultDirectory = path.join(root, '.benchmark', 'results');
await fs.mkdir(resultDirectory, { recursive: true });
const resultFile = path.join(
  resultDirectory,
  `${startedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`,
);
await fs.writeFile(resultFile, `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(`${JSON.stringify(report)}\n`);
process.stderr.write(`Result written to ${path.relative(root, resultFile)}\n`);
