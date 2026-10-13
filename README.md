# keepresearch/opus · rolling

公开维护的 `discordjs/opus` fork，保留 `@discordjs/opus` 包名、CommonJS 入口及 OpusEncoder API。当前静态链接官方 **libopus 1.6.1**，N-API v3，使用官方 CMake SIMD 构建及运行时 CPU 检测。不发布 npm 或 GitHub Packages。

## 安装和使用

Release 发布且消费者验证成功后，依赖固定到该版本的完整 commit SHA：

```json
{
  "dependencies": {
    "@discordjs/opus": "git+https://github.com/keepresearch/opus.git#<完整40位commitSHA>"
  }
}
```

pnpm 对 Git 依赖按仓库来源审批安装脚本，仅允许包名不足以授权。pnpm 12 配置如下：

```yaml
allowBuilds:
  '@discordjs/opus@git+https://github.com/keepresearch/opus.git': true
```

正常安装匿名下载 **keepresearch/opus 自己的固定版本 Release** 的 manifest 和 `.node`，校验版本、目标和 SHA-256 后安装。无需 GitHub token、Rust 或原生编译器；不自动回退源码、不下载上游旧版产物。需要网络访问 GitHub/GitHub Release CDN。Commit 和版本 tag 必须一一对应；不要将未发布的 rolling HEAD 用于普通安装。

```js
const { OpusEncoder, getLibopusVersion } = require('@discordjs/opus');
const codec = new OpusEncoder(24000, 1);
const packet = codec.encode(pcm16Buffer);
const pcm = codec.decode(packet);
console.log(getLibopusVersion()); // libopus 1.6.1
```

现有 encode/decode、applyEncoderCTL/applyDecoderCTL、setBitrate/getBitrate 保留；PCM 为有符号 16 位小端字节，实例持有独立 codec 状态。默认 AUDIO、complexity 9；只升级库及构建，不改变线程模型。新增 getLibopusVersion() 供诊断。跨 libopus 版本不承诺编码字节、包长度或解码采样逐点完全一致。

## 预编译支持

| 系统        | 架构       | 最低环境                       |
| ----------- | ---------- | ------------------------------ |
| Linux glibc | x64、ARM64 | glibc 2.28                     |
| Linux musl  | x64、ARM64 | musl 1.2.5（Alpine 3.22 构建） |
| macOS       | x64、ARM64 | macOS 11.0                     |

Node `^20.17.0 || >=22.9.0`。每种平台只有一份 N-API v3 文件，CI 在 Node 20/22/24/26 验证加载复用；未来 Node 版本不自动视为已验证。Windows、32 位平台没有预编译或源码构建支持。不同架构的实例都可用于 Node Worker Threads。没有 system libopus 依赖。

x64 编译 SSE/AVX2 可用实现并在运行时选择；不预设 AVX2/SSE4.1，不使用 `-march=native`。ARM64 使用 NEON；官方源列表取代原手写 SILK NEON 列表。Release、浮点内部计算，关闭 fast-math、DRED、OSCE。构建参数及实际 SIMD 宏记录在 Release manifest。系统/libc 类型不匹配时明确报错；安装不精确检测 musl/macOS 的最低版本，调用者需符合上表。

## 显式源码构建

需要 C/C++、CMake、Python，以及下载固定 Opus 归档和 Node headers 的网络连接；不需要 Rust。在源码 checkout 内：

```sh
npm ci --ignore-scripts
npm run build:source
npm test
npm run typecheck
npm run lint
```

安装 Git 依赖时可设置 `OPUS_BUILD_FROM_SOURCE=1`。`OPUS_BUILD_JOBS` 控制并行构建数量（默认最多 4）；`OPUS_NODE_HEADERS` 可指定已有 Node headers 目录。下载源码固定在 `vendor/source.json`，SHA-256 不一致立即失败。原生构建使用新建临时目录，避开 pnpm 包路径含 `=` 的问题，结束后清理；源码归档、解压目录、缓存、二进制均不提交 Git。

## 分支与发布

main 保留上游源码基线，但删除继承的旧工作流以避免误触；默认分支及所有维护均使用 rolling。rolling push / PR 跑六目标原生构建、回归和跨 Node 测试，不自动发布。版本号在 package.json，**所有发布 tag 以 rolling- 开头**，命名固定为 `rolling-${version}`，tag commit 必须属于 rolling。

当前版本为 `0.10.1-keepresearch.2`，tag 为 `rolling-0.10.1-keepresearch.2`。推送 tag 后，Actions 全部验证通过才生成带六个 `.node`、manifest.json 和 LICENSES.txt 的预发布 Release。附件名称含版本、N-API、系统、架构和 libc；不按 Node ABI 或具体 glibc 小版本重复构建。已公开的附件不可覆盖，修复使用新版本与 tag。随后 CI 在隔离消费者验证真实公开 Git 安装，并禁止编译。发布完成与消费者验证通过分别判断。

使用公开仓库标准 runner，不使用 larger runner。构建权限只读，发布任务用当前仓库 GITHUB_TOKEN 的 contents:write，无 npm token；不使用 pull_request_target。Actions artifacts 只作内部中转并保留 3 天，长期附件位于 Releases。

源码包装层保留原 MIT LICENSE；libopus BSD-3-Clause 许可见 vendor/OPUS-LICENSE。Fork 未验证真实设备音质或完整服务容量，历史实验性能结果不代替当前构建验证。
