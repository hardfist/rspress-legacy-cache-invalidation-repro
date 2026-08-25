import { defineConfig } from '@rspress/core';

const variant = process.env.RSPRESS_BENCH_VARIANT ?? 'legacy';
const cacheDirectory =
  process.env.RSPRESS_BENCH_CACHE_DIR ?? '.cache/rspack';

function visitRules(rules, visitor) {
  if (!Array.isArray(rules)) {
    return;
  }

  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') {
      continue;
    }
    visitor(rule);
    visitRules(rule.oneOf, visitor);
    visitRules(rule.rules, visitor);
  }
}

function enableNewCache(config) {
  let matchedLoaders = 0;

  visitRules(config.module?.rules, rule => {
    if (!Array.isArray(rule.use)) {
      return;
    }

    for (const use of rule.use) {
      if (
        use &&
        typeof use === 'object' &&
        typeof use.loader === 'string' &&
        /[/\\]node[/\\]mdx[/\\]loader\.js$/.test(use.loader)
      ) {
        use.cache = true;
        matchedLoaders += 1;
      }
    }
  });

  if (matchedLoaders === 0) {
    throw new Error('Unable to find the Rspress MDX loader rule');
  }

  config.experiments = {
    ...config.experiments,
    newCache: true,
  };
}

export default defineConfig({
  title: 'Rspress persistent cache benchmark',
  ssg: false,
  builderConfig: {
    performance: {
      buildCache: {
        cacheDirectory,
      },
      printFileSize: false,
    },
    tools: {
      rspack(config) {
        if (variant === 'new-full') {
          enableNewCache(config);
        }
        return config;
      },
    },
  },
});
