import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const benchmarkScript = path.join(root, 'scripts', 'benchmark.mjs');
const orders = ['legacy,new-full', 'new-full,legacy'];
const maxAttempts = 2;
const reports = [];
const failures = [];

function runOrder(order) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    process.stderr.write(`\nRunning ${order} (attempt ${attempt})\n`);
    const result = spawnSync(process.execPath, [benchmarkScript, order], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    process.stderr.write(result.stderr);

    if (result.status === 0) {
      return JSON.parse(result.stdout);
    }

    failures.push({ order, attempt, status: result.status });
    process.stderr.write(result.stdout);
  }

  return null;
}

for (const order of orders) {
  const report = runOrder(order);
  if (report) {
    reports.push(report);
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function formatDuration(milliseconds) {
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(3)} s`
    : `${milliseconds.toFixed(0)} ms`;
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatDelta(value) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

async function publishSummary(markdown) {
  process.stdout.write(`${markdown}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}

if (reports.length !== orders.length) {
  const failureRows = failures
    .map(item => `| \`${item.order}\` | ${item.attempt} | ${item.status} |`)
    .join('\n');
  await publishSummary(`## Persistent cache benchmark failed

Only ${reports.length} of ${orders.length} execution orders completed after retries.

| Order | Attempt | Exit status |
| --- | ---: | ---: |
${failureRows}`);
  process.exitCode = 1;
} else {
  const variants = new Map();
  for (const report of reports) {
    for (const result of report.results) {
      const current = variants.get(result.variant) ?? {
        cold: [],
        warm: [],
        warmWall: [],
        touch: [],
        cacheBytes: [],
      };
      for (const measurement of result.measurements) {
        if (measurement.label.startsWith('cold-')) {
          current.cold.push(measurement.rspressMs);
        } else if (measurement.label.startsWith('warm-')) {
          current.warm.push(measurement.rspressMs);
          current.warmWall.push(measurement.wallMs);
        } else if (measurement.label.startsWith('touch-')) {
          current.touch.push(measurement.rspressMs);
        }
      }
      current.cacheBytes.push(result.cacheBytes);
      variants.set(result.variant, current);
    }
  }

  const legacy = variants.get('legacy');
  const full = variants.get('new-full');
  const legacyWarm = median(legacy.warm);
  const fullWarm = median(full.warm);
  const legacyWall = median(legacy.warmWall);
  const fullWall = median(full.warmWall);
  const legacyBytes = median(legacy.cacheBytes);
  const fullBytes = median(full.cacheBytes);
  const warmDelta = (fullWarm / legacyWarm - 1) * 100;
  const wallDelta = (fullWall / legacyWall - 1) * 100;
  const sizeDelta = (fullBytes / legacyBytes - 1) * 100;
  const failureNote = failures.length
    ? `\n> ${failures.length} benchmark attempt(s) failed and were retried; successful runs are summarized below.\n`
    : '';
  const rawSamples = [...variants.entries()]
    .map(
      ([variant, values]) =>
        `${variant}: ${values.warm.map(value => `${value} ms`).join(', ')}`,
    )
    .join('\n');

  await publishSummary(`## Legacy cache vs full new cache

- Rspress: \`${reports[0].rspress}\`
- Rspack: \`${reports[0].rspack}\`
- Node: \`${reports[0].node}\`
- Pages: ${reports[0].pages} generated MDX files
- Method: two runs in opposite order; each warm/touch sample is the first reuse of a fresh cold cache, in a fresh Node.js process
- Temporary workaround: this canary can leave a \`.meta\` file pointing to a removed \`.sst\` file on the second cache reopen, so the benchmark does not reopen the same cache twice
${failureNote}
| Variant | Cold median | Unchanged warm median | Warm process wall | Identical-touch median | Cache size |
| --- | ---: | ---: | ---: | ---: | ---: |
| Legacy | ${formatDuration(median(legacy.cold))} | ${formatDuration(legacyWarm)} | ${formatDuration(legacyWall)} | ${formatDuration(median(legacy.touch))} | ${formatBytes(legacyBytes)} |
| Full new cache | ${formatDuration(median(full.cold))} | ${formatDuration(fullWarm)} | ${formatDuration(fullWall)} | ${formatDuration(median(full.touch))} | ${formatBytes(fullBytes)} |

### Full new cache relative to legacy

- Unchanged warm build: **${formatDelta(warmDelta)}**
- Warm process wall: **${formatDelta(wallDelta)}**
- Cache size: **${formatDelta(sizeDelta)}** (${(legacyBytes / fullBytes).toFixed(1)}× smaller)

<details>
<summary>Raw unchanged warm samples</summary>

\`\`\`text
${rawSamples}
\`\`\`
</details>`);
}
