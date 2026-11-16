# 环境 SDK 过渡快照已退役

当前使用 nova-render 0.2 原生/Web 配对包，雾、环境清除、场景阴影和 UI 集成均由正式 API 提供。旧 `prepare-atmosphere` / `compile-atmosphere-web` / `promote-atmosphere` 和源码补丁已删除；历史实现可在迁移前 Git 提交中查看。

安装、校验、责任边界与当前验证范围见 [SDK-OWNERSHIP.md](SDK-OWNERSHIP.md)。请用 `pnpm sdk:install <manifest.json>`，不要复制相邻工作区的单个头文件、静态库或 shader。
