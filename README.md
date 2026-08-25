# Rspress legacy persistent cache invalidation repro

这个仓库复现了一个 Rspress persistent cache 问题：源码没有变化，但在新进程中
再次执行 `rspress build` 时，Rspack 仍会认为 build dependency 已修改，并清空
整个 legacy persistent cache。

复现使用 `@rspress/core@2.0.19` 和 `@rspack/core@2.1.10`。

## 复现

```bash
pnpm install --frozen-lockfile
pnpm repro
```

脚本会清空缓存，并在两个独立进程中执行相同的构建。第二次构建会输出：

```text
normalized initRsbuild dependency: <project>/file:/.../initRsbuild.js
persistent cache invalidated because build dependencies changed
```

运行修复后的对照组：

```bash
pnpm repro:fixed
```

第二次构建会成功恢复缓存：

```text
make persistent cache recovery succeeded
```

配置中的 `cacheDirectory` 仅用于稳定清理缓存，日志插件仅用于显示 cache 状态；
它们不会改变 invalidation 结果。

## 原因

Rspress 默认开启 persistent cache，并将下面的 URL 加入 `buildDependencies`：

```ts
new URL(import.meta.url).href
```

Rspack 将所有 build dependency 都作为普通路径执行 `path.resolve`，所以该 URL
会变成一个不存在的路径：

```text
<project>/file:/.../node_modules/@rspress/core/dist/node/initRsbuild.js
```

错误路径包含 `node_modules`，因此会进入 managed package 的版本查找逻辑：

- 如果项目及其上层 `package.json` 都没有 `version`，Rspack 会退回目录 hash。
  错误路径不存在，snapshot 被记录为 `Strategy::Failed`。下一次启动时，
  `Failed` 被判为 `Modified`，最终触发 `storage.reset_all()`。
- 如果项目或上层 `package.json` 有 `version`，版本查找会从错误路径向上走到
  真实项目目录，并错误地使用项目版本跟踪这条依赖。版本没有变化时校验返回
  `NoChanged`，因此问题被掩盖，但实际依赖仍未被正确跟踪。

完整的 invalidation 链路为：

```text
file: URL
  → path.resolve 生成不存在的路径
  → Strategy::Failed
  → ValidateResult::Modified
  → InvalidBuildDependencies
  → storage.reset_all()
```

## 修复

Rspress 应该传递真实文件路径：

```ts
import { fileURLToPath } from 'node:url';

fileURLToPath(import.meta.url)
```

添加根包 `version` 只能掩盖问题，不是修复。本仓库的 `pnpm repro:fixed` 会在
Rspack 配置阶段执行相同的 URL 转换，用于验证修复结果。

## 相关源码

- [Rspress 传入 `file:` URL](https://github.com/web-infra-dev/rspress/blob/e4a85b918e47eb6cf200d7ff9850568b99f39dd5/packages/core/src/node/initRsbuild.ts#L269-L272)
- [Rspack 对 dependency 执行 `path.resolve`](https://github.com/web-infra-dev/rspack/blob/v2.1.10/packages/rspack/src/config/normalization.ts#L304-L306)
- [`Strategy::Failed` 被判为 `Modified`](https://github.com/web-infra-dev/rspack/blob/v2.1.10/crates/rspack_core/src/cache/persistent/snapshot/strategy/mod.rs#L319-L328)
- [build dependency 无效时调用 `invalidate`](https://github.com/web-infra-dev/rspack/blob/v2.1.10/crates/rspack_core/src/cache/persistent/context.rs#L99-L115)，随后
  [`invalidate` 调用 `storage.reset_all()`](https://github.com/web-infra-dev/rspack/blob/v2.1.10/crates/rspack_core/src/cache/persistent/context.rs#L145-L154)
