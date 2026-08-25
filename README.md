# Rspress legacy persistent cache 每次启动都失效的问题

这个仓库复现了一个 Rspress 默认配置下的 persistent cache 问题：源码没有变化，
但在新的进程中再次执行 `rspress build` 时，Rspack 仍会认为 build dependency
发生修改，清空整个 legacy persistent cache。

本仓库使用正式版依赖，不依赖 canary：

- `@rspress/core@2.0.19`
- `@rspack/core@2.1.10`
- Node.js 22
- pnpm 11.22.0

## 如何复现

```bash
pnpm install --frozen-lockfile
pnpm repro
```

`pnpm repro` 会先清空缓存，然后在两个独立进程中连续执行两次相同的
`rspress build`，期间不修改任何源码。

第二次构建可以看到：

```text
normalized initRsbuild dependency: <project>/file:/.../initRsbuild.js

persistent cache invalidated because build dependencies changed:
modified paths (1):
  - <project>/file:/.../initRsbuild.js
```

这说明 warm build 没有成功恢复上一个进程的 legacy persistent cache。

运行临时修复版本：

```bash
pnpm repro:fixed
```

临时修复把 `file:` URL 转成真实文件路径。第二次构建会输出：

```text
build dependencies are valid (5 tracked)
snapshot restored with no changed dependencies
make persistent cache recovery succeeded
```

## 问题结论

问题不是 MDX loader 没有缓存，也不是指定 canary 版本引入的 regression。

真正的原因是：Rspress 把一个 `file:` URL 作为 build dependency 传给 Rspack，
而 Rspack legacy cache 把所有 build dependency 都当成普通文件路径执行
`path.resolve`。最终得到一个不存在的路径，snapshot 校验又把该路径的
`Strategy::Failed` 固定视为 `Modified`，导致每个新进程都执行全量缓存重置。

同样的问题已经在正式版 `@rspack/core@2.1.10` 中复现，因此不能归因于
`2.2.0-canary-12bde9b1-20260824102525`。canary 与此前测试的
`new_cache.loader` 功能有关，但与这里的 legacy cache invalidation 无关。

## 完整触发过程

### 1. Rspress 默认添加了一个 `file:` URL

Rspress 默认开启 persistent cache，除非显式设置：

```bash
RSPRESS_PERSISTENT_CACHE=false
```

开启缓存时，Rspress 会把下面的值放进 `buildDependencies`：

```ts
new URL(import.meta.url).href
```

它的结果是 URL，而不是文件路径：

```text
file:///Users/example/node_modules/@rspress/core/dist/node/initRsbuild.js
```

### 2. Rspack 把 URL 当成普通路径处理

Rspack 2.1.10 对每个 build dependency 执行：

```ts
path.resolve(context, dependency)
```

`path.resolve` 不识别 `file:` URL 语义，因此生成：

```text
<project>/file:/Users/example/node_modules/@rspress/core/dist/node/initRsbuild.js
```

这是一个挂在项目目录下的假路径，文件系统中并不存在。

### 3. 路径中的 `node_modules` 触发 managed package 策略

Rspack 默认把包含 `node_modules` 的路径视为 managed path。它会从目标路径
逐级向上查找带 `version` 的 `package.json`：

```text
<project>/file:/.../node_modules/@rspress/core
<project>/file:/.../node_modules
<project>/file:/...
<project>/file:
<project>
```

由于前面的目录都是假路径，查找最终可能走到真实的项目目录。

### 4. 根包有 `version` 时，问题为什么会被掩盖

如果项目或更上层的 `package.json` 包含：

```json
{
  "version": "1.0.0"
}
```

package lookup 会错误地把这条 `initRsbuild.js` 依赖记录成类似：

```text
PackageVersion("1.0.0")
```

下一次构建时，项目版本通常没有变化，因此校验返回 `NoChanged`。缓存看起来
有效，但实际跟踪的是项目版本，并不是真正的 `initRsbuild.js`。这只是掩盖了
错误；添加根包 `version` 不是正确修复。

在 monorepo 中，如果更上层的 `package.json` 有 `version`，也可能产生相同的
掩盖效果。

### 5. 根包没有 `version` 时，为什么每次都会 invalidation

如果向上找不到任何 package version，Rspack 会退回 BUILD dependency 的目录
hash 策略。由于 `<project>/file:/...` 并不存在，目录 hash 失败，snapshot 被
记录为：

```text
Strategy::Failed
```

第一次冷构建会把这个失败策略写入缓存。第二个进程恢复并校验 snapshot 时，
Rspack 固定执行：

```rust
Strategy::Failed => ValidateResult::Modified
```

随后形成下面的调用链：

```text
Strategy::Failed
  → ValidateResult::Modified
  → InvalidBuildDependencies
  → CacheContext::invalidate()
  → storage.reset_all()
```

所以每个新进程都会清空上一轮写入的 persistent cache。构建结束时虽然还会
重新写缓存，但下一次启动又会重复相同的 invalidation，这就是 legacy cache
warm build 没有明显变快的原因。

## 为什么默认终端里可能看不到 warning

这条信息虽然使用了 warning 级别，但它属于 `rspack.persistentCache` 的 stats
logging，不是 compilation 的 `stats.warnings`。Rspress/Rsbuild 默认输出没有渲染
这部分 stats logging，因此缓存可能已经执行 `reset_all()`，终端却看不到原因。

本仓库中的 `ShowLegacyCacheStatePlugin` 只负责使用下面的配置取出并打印该日志：

```js
stats.toString({
  all: false,
  logging: 'verbose',
});
```

它不会改变 persistent cache 的校验结果。仓库显式设置 `cacheDirectory` 也只是
为了让复现脚本能够稳定清理缓存，不是 invalidation 的触发原因。

## 正确修复与临时绕过

正确修复应该发生在 Rspress 传递 build dependency 的位置：

```ts
import { fileURLToPath } from 'node:url';

fileURLToPath(import.meta.url)
```

而不是传递：

```ts
new URL(import.meta.url).href
```

本仓库的 `pnpm repro:fixed` 在 Rspack 配置阶段把以 `file:` 开头的 dependency
执行 `fileURLToPath`，用于证明转换后 legacy cache 可以正常恢复。这是 demo
中的临时绕过，最终应该由 Rspress 输出正确的文件系统路径。

## 相关源码

- [Rspress 传入 `file:` URL](https://github.com/web-infra-dev/rspress/blob/e4a85b918e47eb6cf200d7ff9850568b99f39dd5/packages/core/src/node/initRsbuild.ts#L269-L272)
- [Rspack 对 dependency 执行 `path.resolve`](https://github.com/web-infra-dev/rspack/blob/v2.1.10/packages/rspack/src/config/normalization.ts#L304-L306)
- [`Strategy::Failed` 被判为 `Modified`](https://github.com/web-infra-dev/rspack/blob/v2.1.10/crates/rspack_core/src/cache/persistent/snapshot/strategy/mod.rs#L319-L328)
- [build dependency 无效时调用 `invalidate`](https://github.com/web-infra-dev/rspack/blob/v2.1.10/crates/rspack_core/src/cache/persistent/context.rs#L99-L115)
- [`invalidate` 调用 `storage.reset_all()`](https://github.com/web-infra-dev/rspack/blob/v2.1.10/crates/rspack_core/src/cache/persistent/context.rs#L145-L154)

复现和临时绕过的实现分别位于：

- [`scripts/repro.mjs`](./scripts/repro.mjs)
- [`rspress.config.mjs`](./rspress.config.mjs)
