import fs from 'node:fs';
import mdxLoader from '@rspress/core/dist/node/mdx/loader.js';

export default function probeMdxLoader(source) {
  const probeFile = process.env.RSPRESS_CACHE_PROBE_FILE;
  if (!probeFile) {
    throw new Error('RSPRESS_CACHE_PROBE_FILE is not set');
  }

  fs.appendFileSync(
    probeFile,
    `${JSON.stringify({
      build: process.env.RSPRESS_CACHE_PROBE_BUILD,
      resource: this.resourcePath,
    })}\n`,
  );

  return mdxLoader.call(this, source);
}
