import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rspress/core';

const fixed = process.env.RSPRESS_CACHE_PROBE_FIXED === 'true';
const probeLoader = fileURLToPath(
  new URL('./scripts/probe-mdx-loader.mjs', import.meta.url),
);

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

export default defineConfig({
  title: 'Rspress MDX loader cache reproduction',
  ssg: false,
  markdown: {
    crossCompilerCache: false,
  },
  builderConfig: {
    performance: {
      buildCache: {
        cacheDirectory: '.cache/rspack',
      },
      printFileSize: false,
    },
    tools: {
      rspack(config) {
        let matched = 0;

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
              use.loader = probeLoader;
              if (fixed) {
                use.cache = true;
              }
              matched += 1;
            }
          }
        });

        if (matched === 0) {
          throw new Error('Rspress MDX loader rule was not found');
        }

        config.experiments = {
          ...config.experiments,
          newCache: {
            codeGeneration: false,
            devtool: false,
            loader: true,
            minimize: false,
          },
        };

        return config;
      },
    },
  },
});
