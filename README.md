# Rspress legacy persistent-cache invalidation reproduction

This repository reproduces why Rspress can invalidate Rspack's **legacy
persistent cache on every new process**, even when no source file changed.

It pins:

- `@rspress/core@2.0.19`
- `@rspack/core@2.2.0-canary-12bde9b1-20260824102525`
- Node.js 22 and pnpm 11.22.0

## Reproduce

```bash
pnpm install --frozen-lockfile
pnpm repro
```

The second build reports:

```text
normalized initRsbuild dependency: <project>/file:/.../initRsbuild.js
persistent cache invalidated because build dependencies changed
```

Run the same two-process build after converting the URL to a filesystem path:

```bash
pnpm repro:fixed
```

The warm build then reports that its build dependencies are valid and that
persistent-cache recovery succeeded.

## Cause

Rspress adds `new URL(import.meta.url).href` to `buildDependencies`, producing a
`file:` URL. Rspack legacy-cache normalization passes that value to
`path.resolve(context, dependency)`, producing a nonexistent path such as
`<project>/file:/.../initRsbuild.js`.

Because the malformed path contains `node_modules`, snapshot calculation first
tries package-version tracking. This reproduction intentionally has no
`version` in its root `package.json`, so package lookup cannot find a version and
directory hashing returns `Strategy::Failed`. Legacy-cache validation treats
`Failed` as `Modified`, marks the build dependencies invalid, and resets all
persistent-cache storage on every process start.

Adding a root package version only masks the issue: the malformed dependency is
then incorrectly tracked using the application's version. The proper fix is to
convert the `file:` URL with `fileURLToPath` before passing it to Rspack.

The checked-in Rsbuild patch only makes Rsbuild load the pinned canary package;
it does not modify cache behavior.
