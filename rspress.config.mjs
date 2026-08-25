import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rspress/core';

const fixed = process.env.RSPRESS_FIX_BUILD_DEPENDENCY === 'true';

function persistentCacheLog(stats) {
  const output = stats.toString({
    all: false,
    colors: false,
    logging: 'verbose',
  });
  const marker = /(?:DEBUG )?LOG from rspack\.persistentCache/;
  const match = marker.exec(output);

  if (!match) {
    return '';
  }

  const rest = output.slice(match.index);
  const nextBlock = rest.search(/\n\n(?:DEBUG )?LOG from /);
  return (nextBlock === -1 ? rest : rest.slice(0, nextBlock)).trim();
}

const showLegacyCacheStatePlugin = {
  apply(compiler) {
    const dependency = compiler.options.cache?.buildDependencies?.find(dep =>
      dep.includes('initRsbuild'),
    );

    if (dependency) {
      process.stdout.write(`normalized initRsbuild dependency: ${dependency}\n`);
    }

    compiler.hooks.done.tap('ShowLegacyCacheStatePlugin', stats => {
      const output = persistentCacheLog(stats);
      if (output) {
        process.stdout.write(`\n${output}\n`);
      }
    });
  },
};

export default defineConfig({
  title: 'Rspress legacy cache invalidation reproduction',
  ssg: false,
  builderConfig: {
    performance: {
      buildCache: {
        cacheDirectory: '.cache/rspack',
      },
      printFileSize: false,
    },
    tools: {
      rspack(config) {
        if (
          fixed &&
          config.cache &&
          typeof config.cache === 'object' &&
          Array.isArray(config.cache.buildDependencies)
        ) {
          config.cache.buildDependencies = config.cache.buildDependencies.map(
            dependency =>
              dependency.startsWith('file:')
                ? fileURLToPath(dependency)
                : dependency,
          );
        }

        config.plugins ??= [];
        config.plugins.push(showLegacyCacheStatePlugin);
        return config;
      },
    },
  },
});
