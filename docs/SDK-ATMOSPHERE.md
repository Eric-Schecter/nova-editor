# 编辑器环境 SDK 快照

> 分工调整（2026-11-16）：本文记录已有过渡快照的重现方式，不再代表编辑器负责长期维护雾效实现。渲染底层由 nova-render 提供，正式包验收后退役补丁。当前阶段与替换条件见 [SDK-OWNERSHIP.md](SDK-OWNERSHIP.md)。

编辑器仍只消费已编译的 Nova SDK。新增雾效需要配对更新原生头文件、静态库、Web JS 和着色器；不可只替换其中一个文件。扩展 `scene-raster-fog-v1` 与 `environment-clear-v1` 在隔离副本中实现，未写入正在开发的 nova-v2 工作区。

本次原生源基于 `f016292068826553fca948c08b3de5fbb9f1eb75` 的本地 dirty 快照，2026-11-16 09:30 捕获。Web 保留原编辑器 `6888d8a` API 基线，再应用相同的栅格雾扩展。**不是干净的上游发布包，也不表示已验证上游最新全部功能。** 构建期间出现的后续 SDK 打包提交未混入此依赖。

`nova-sdk.lock.json` 记录 220 个文件哈希、基线信息、补丁哈希和源清单哈希。`tools/sdk/patches/atmosphere-base.json` 是原生 render/cmake、根 CMake 和 Web 基线逐文件清单；五个受修改的 Web 基线文件保存在 `atmosphere-web-base/`，避免重复补丁。准备脚本在源发生变化时拒绝继续，要求重新审核；当前提交中独立变动的安装脚本从已记录提交读取。其余旧编辑器扩展保留。

重新构建（本机 macOS 示例）：

```sh
node tools/sdk/prepare-atmosphere.mjs ../nova-v2 output/atmosphere-sdk-new
cmake -S output/atmosphere-sdk-new -B output/atmosphere-sdk-new/build \
  -DCMAKE_BUILD_TYPE=Debug -DNOVA_BUILD_EXAMPLES=OFF -DNOVA_BUILD_TOOLS=OFF \
  -DBUILD_TESTING=OFF -DNOVA_ENABLE_UI=ON -DNOVA_ENABLE_VULKAN=ON \
  -DNOVA_BUNDLE_DEPENDENCIES=ON -DVCPKG_TARGET_TRIPLET=arm64-osx \
  -DVCPKG_INSTALLED_DIR="$PWD/../nova-v2/build/vcpkg_installed" \
  -DCMAKE_PREFIX_PATH="$PWD/../nova-v2/build/vcpkg_installed/arm64-osx" \
  -DCMAKE_INSTALL_PREFIX="$PWD/output/atmosphere-sdk-new/install"
cmake --build output/atmosphere-sdk-new/build --target nova_render -j 6
cmake --install output/atmosphere-sdk-new/build
node tools/sdk/compile-atmosphere-web.mjs "$PWD/output/atmosphere-sdk-new"
node tools/sdk/promote-atmosphere.mjs output/atmosphere-sdk-new
npm run sdk:verify
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j 6
npm test
ctest --test-dir build --output-on-failure
npm run build:web
./build/world_contract_test "$PWD" gpu
```

路径必须独立且新建；源码清单发生变化时先检查 API、uniform 布局、着色器及 ABI，再更新基线，不可跳过校验。普通 `sdk:stage` 会拒绝覆盖这套扩展。上游正式提供兼容雾效后，再删除编辑器补丁并切换正式配对产物。后续发布应提供 native/Web 配对包与版本清单，而非追随工作区文件。

栅格 SceneUniforms 从 384 扩为 416 字节；路径追踪保持原 512 字节参数结构和前 384 字节场景布局。雾只用于编辑器栅格渲染。双端按视空间深度计算线性/指数平方雾；相机切换和正交投影自动生效。背景天空不参与雾混合，模型、地面和网格参与。编辑器颜色以 sRGB 十六进制保存，SDK fogColor 使用线性颜色；两端输出路径分别转换。空路径 / null 清除环境贴图并恢复摄影棚补光。

环境贴图运行时支持预处理 `.nenv`（NOVENV01/02），直接 HDR/EXR 导入需先用 Nova 的 `nova_environment_bake` 工具离线转换。内置摄影棚和日落贴图各约 20 MiB，来源及 CC0 许可见 `resources/environments/SOURCES.md`。预设资源由构建复制，导入后存为项目内不可变资源，项目不依赖源路径或预设 URL。
