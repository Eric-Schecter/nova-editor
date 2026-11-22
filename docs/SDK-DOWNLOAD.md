# GitHub Release 配对依赖

默认来源为 `Eric-Schecter/nova-render` 的正式 GitHub Release。原生库/头文件、Web 模块和 shader 必须使用同一版本、同一干净源码提交，不能单独更新其中一端。当前兼容范围为稳定的 **0.8.x、0.9.x 和 0.10.x**。当前锁定 0.10.22，原生窗口由 C++ SDK 内的 SDL3 管理。

## 安装与锁定

已有仓库锁文件，直接恢复已锁定版本：

```sh
pnpm sdk:install
pnpm sdk:verify
```

安装不查询 latest、不自动升级。锁文件包含精确版本、源码提交、目标平台/配置、Release ID、附件 ID、清单地址和 SHA-256、两份包的 SHA-256，以及安装后的文件校验清单。请提交 `nova-sdk.lock.json`，不要提交 `deps/nova/`、`.cache/nova/` 或网页 `public/sdk/` 部署副本。

首次迁移旧锁文件或显式选择版本：

```sh
pnpm sdk:update 0.8.0
```

也兼容 `sdk:install 0.8.0` 或正式的版本化 `manifest.json` URL 来建立首次锁；已有新格式锁时，`sdk:install <不同版本>` 会要求使用 `sdk:update`。本地配对 manifest 安装仍用于离线开发联调，会明确记录为 `local-package`，不能冒充 Release 安装。经 `sdk:update` 可把本地开发配对包切换到同版本的正式 Release；正式 Release 一旦锁定，仍拒绝同版本内容或来源变更。

## 检查与更新

```sh
pnpm sdk:update --check
pnpm sdk:update 0.2.1
```

`--check` 仅报告 API 兼容范围内最新的已发布候选，不安装、不修改锁文件，也不代表候选已经提供本机平台包。第二条是将来版本发布后的命令示例，当前不保证 0.2.1 已存在。更新必须指定精确版本，不接受 latest、版本区间或预发布版本。

更新先下载并验证清单、全部必需功能、原生平台/架构/Release/UI 配置、Web 包名、两份包的哈希、包内版本/提交及 shader 清单。只有全部通过后才更换安装。已锁定版本若被删除重建、替换清单或重新上传不同内容，会拒绝；不能通过重复执行同版本更新来忽略锁定哈希。

升级完成后运行业务测试、双端构建及相关真实渲染回归，再提交锁文件。回退使用 `sdk:update <之前已验证的精确版本>`，同样校验配对来源和内容。

## 缓存、离线及失败处理

下载缓存位于 `.cache/nova/sha256/<文件哈希>`，每次使用都重新校验。缓存齐全时可重建已安装目录：

```sh
pnpm sdk:install --offline
```

离线缺文件或缓存损坏会明确失败，不自动借用其他版本。清单和 Release 元数据通过 Node HTTPS 获取，超时可用系统 curl 重试同一官方 URL；较大的原生/Web 包使用系统 curl 断点续传，最多重试三次，并将尚未校验的分段保存在缓存的 `partial/` 子目录。再次联网安装会继续传输，只有完整 SHA-256 通过才进入有效缓存。离线安装不使用这些未完成分段。TLS 校验和哈希要求保持不变，网络失败不更新锁文件。使用方需要 Node、CMake 与 curl；不需要渲染源码和 shader 编译器。GitHub API 遇到限流/拒绝时可使用已有的 gh 登录会话；CI 也支持通过 GITHUB_TOKEN 或 GH_TOKEN 认证，只向 GitHub API 发送令牌，不记录令牌到锁文件或下载地址。

安装先解压到独立暂存目录，拒绝越界路径和符号链接，再核对原生/Web 包内来源。更换原生目录、Web 目录、配对元数据和锁文件采用带备份与日志的事务：中途异常回滚，进程中断后下次安装先恢复；并发安装会被阻止。恢复过程中发生磁盘/权限故障时保留日志和备份供后续处理。此机制不承诺断电级持久性。

请先停止开发服务器、关闭使用 SDK 的原生程序，再升级依赖。构建不要与安装并行；网页启动/构建会校验 `deps/nova/` 并自动修复部署副本，CMake 配置会检查正式 native/Web 包的版本和提交与锁文件相符，但不是跨进程构建锁。

## 平台与其他依赖

目前 0.8.0 Release 的原生包只提供 **macOS ARM64 Release、启用 UI**。Windows/Linux 不会自动降级借用 0.1.0，也不会让网页端悄悄使用另一版本；缺少匹配包时直接说明不支持。未来上游提供新的平台清单/包布局后，再扩展选择逻辑并分别验证 ABI/Runtime。

SDK 缓存是可删除重建的渲染依赖。编辑器自己的 nlohmann/json 3.12.0 头文件及 MIT 许可位于 `third_party/nlohmann-json/`，不依赖 `.sdk/support` 或相邻 nova-v2/vcpkg 工作区；模型和环境贴图仍由编辑器项目管理。

## 可见目录布局与旧安装迁移

- `deps/nova/native/`：正式原生 SDK，含头文件、静态库和 CMake 配置。
- `deps/nova/web/`：正式网页 SDK，含 `src/` 模块与 `generated/` shader/资源。
- `deps/nova/package/`：配对 manifest 与网页 package 元数据。
- `.cache/nova/`：按哈希存放的下载、partial、安装锁、回滚日志和暂存目录。
- `apps/web/public/sdk/`：网页部署副本，不作为依赖源；部署URL仍为 `sdk/`，子路径站点无需改链接。

锁格式 v4 明确记录布局，`files` 仅记录 `deps/nova/` 中的正式依赖。`sdk:verify` 另外按相同哈希检查 Web 部署副本；构建前 `sdk:sync-web` 能从正式包原子重建缺失/损坏的副本，依赖源本身损坏则拒绝部署。同步不修改锁文件，也不重新下载或编译 SDK。

旧格式 v2/v3 的配对锁可通过 `sdk:install` 迁移路径，原版本、Release ID、源码提交和附件哈希不变。旧 `.sdk/cache/sha256/` 中哈希有效的文件会导入新缓存，因此可用 `sdk:install --offline` 完成迁移。旧安装中断日志会先回滚；旧安装进程仍运行时会拒绝并发迁移。迁移成功后旧 `.sdk/` 可自行备份/删除，安装器不会丢弃其中的自定义文件或历史备份。

CMake 会自动将以前的默认 `.sdk/native` 改到 `deps/nova/native`，并清除仍指向旧目录的包导入缓存；显式指定的外部 SDK 路径保留。包仍需匹配锁定提交。锁/元数据变化会触发重新配置。支持继续使用现有 `build/`，也可使用新构建目录验收。

网页编辑器可在「光照」里开启「半分辨率阴影」，用于光栅视口中的动态投影预览。默认使用全分辨率。
