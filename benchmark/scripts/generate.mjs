import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docs = path.join(root, 'docs');

await fs.rm(docs, { recursive: true, force: true });
await fs.mkdir(docs, { recursive: true });

const sections = Array.from(
  { length: 30 },
  (_, section) => `
## Section ${section}

This paragraph contains **formatted text**, a [link](https://example.com), and
some inline code: \`const value = ${section}\`.

\`\`\`tsx
export function Example${section}() {
  const items = Array.from({ length: 12 }, (_, index) => index + ${section});
  return <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>;
}
\`\`\`

<div data-section={${section}}>{${section} * 2}</div>
`,
).join('\n');

for (let page = 0; page < 200; page += 1) {
  const source = `---
title: Benchmark page ${page}
---

# Benchmark page ${page}

export const pageNumber = ${page};

${sections}`;

  await fs.writeFile(path.join(docs, `page-${page}.mdx`), source);
}

await fs.writeFile(
  path.join(docs, 'index.mdx'),
  '# Persistent cache benchmark\n\n[Open page 0](/page-0)\n',
);

process.stdout.write('Generated 201 MDX files in docs/.\n');
