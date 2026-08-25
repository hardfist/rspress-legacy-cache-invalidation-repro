import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectPackageJson = JSON.parse(
  await fs.readFile(path.join(root, 'package.json'), 'utf8'),
);
const rspressRoot = path.join(root, 'node_modules', '@rspress', 'core');
const rspressPackageJson = JSON.parse(
  await fs.readFile(path.join(rspressRoot, 'package.json'), 'utf8'),
);
const rspressBin =
  typeof rspressPackageJson.bin === 'string'
    ? rspressPackageJson.bin
    : rspressPackageJson.bin.rspress;
const cli = path.join(rspressRoot, rspressBin);
const fixed = process.argv.includes('--fixed');

if (Object.hasOwn(projectPackageJson, 'version')) {
  throw new Error(
    'This reproduction requires the root package.json to have no version field.',
  );
}

await fs.rm(path.join(root, '.cache'), { recursive: true, force: true });
await fs.rm(path.join(root, 'doc_build'), { recursive: true, force: true });

function build(label) {
  process.stdout.write(`\n===== ${label} =====\n`);
  const result = spawnSync(process.execPath, [cli, 'build'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      RSPRESS_FIX_BUILD_DEPENDENCY: fixed ? 'true' : 'false',
    },
  });

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  if (result.status !== 0) {
    throw new Error(`Rspress build failed with status ${result.status}`);
  }

  return `${result.stdout}\n${result.stderr}`;
}

build('cold build');
const warmOutput = build('warm build in a new process');
const dependency = warmOutput.match(
  /normalized initRsbuild dependency: (.+)/,
)?.[1];

if (!dependency) {
  throw new Error('The initRsbuild build dependency was not printed.');
}

if (fixed) {
  if (dependency.includes('file:')) {
    throw new Error(`Expected a filesystem path, received: ${dependency}`);
  }
  if (!warmOutput.includes('build dependencies are valid')) {
    throw new Error('Expected the warm build dependencies to be valid.');
  }
  if (!warmOutput.includes('make persistent cache recovery succeeded')) {
    throw new Error('Expected the warm build to recover the persistent cache.');
  }

  process.stdout.write(
    '\nPASS: converting the file URL to a filesystem path keeps the legacy cache valid.\n',
  );
} else {
  if (!dependency.includes('file:')) {
    throw new Error(`Expected a malformed file URL path, received: ${dependency}`);
  }
  if (
    !warmOutput.includes(
      'persistent cache invalidated because build dependencies changed',
    )
  ) {
    throw new Error('Expected the warm build to invalidate the legacy cache.');
  }

  process.stdout.write(
    '\nPASS: the malformed build dependency invalidated the legacy persistent cache.\n',
  );
}
