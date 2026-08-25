# Rspress MDX persistent-cache miss reproduction

Minimal reproduction showing that Rspress's MDX loader does not use Rspack's
experimental persistent loader cache unless its rule explicitly sets
`use.cache: true`.

Pinned versions:

- `@rspress/core@2.0.19`
- `@rspack-canary/core@2.2.0-canary-12bde9b1-20260824102525`

## Reproduce

Requirements: Node.js 20 or newer and pnpm.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm repro
```

The command enables `experiments.newCache.loader`, clears the persistent
cache, and starts two independent `rspress build` processes without changing
the MDX source. A transparent wrapper around Rspress's real MDX loader records
each execution.

Expected result:

```text
===== cold build =====
...
===== warm build in a new process =====
...
PASS: MDX loader warm executions: 1 (persistent-cache miss).
```

Rspress's own `markdown.crossCompilerCache` is disabled so it cannot mask the
Rspack loader-cache behavior.

## Verify the one-line integration

```bash
pnpm repro:fixed
```

The fixed variant adds `cache: true` to the existing Rspress MDX loader entry.
The wrapper runs during the cold build but is restored from persistent cache
in the second process:

```text
PASS: cache: true restored 1 MDX loader result(s); warm executions: 0.
```

The relevant configuration is in [`rspress.config.mjs`](./rspress.config.mjs).

## Why the Rsbuild patch exists

Rspress 2.0.19 installs a stable Rspack through Rsbuild. The committed pnpm
patch changes Rsbuild's single runtime import from `@rspack/core` to the exact
canary package, ensuring the compiler under test is actually the pinned
canary instead of a nested stable copy. It does not change cache behavior.
