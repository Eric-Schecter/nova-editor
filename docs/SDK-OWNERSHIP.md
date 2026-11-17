# Nova Render 与编辑器分工

编辑器现使用 nova-render **0.2 配对包**，已验证的源码提交由 `nova-sdk.lock.json` 和包内元数据记录。版本 `0.2.0` 已发布到 [GitHub Release](https://github.com/Eric-Schecter/nova-render/releases/tag/v0.2.0)，源码为 `9c133a2`。原生库、头文件、Web 模块和预编译 shader 来自同一干净提交；SDK 不再在编辑器中打补丁或重新编译。

## 依赖安装

```sh
pnpm sdk:install
pnpm sdk:verify
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j 6
pnpm test
ctest --test-dir build --output-on-failure
pnpm build:web
```

安装器在替换前核对包版本、平台/架构、全部必需功能、SHA-256 及 native/Web 源码提交。`deps/nova/native/` 与 `deps/nova/web/` 是可见的正式安装目录，`deps/nova/package/` 保存配对元数据；网页 `apps/web/public/sdk/` 是自动生成的部署副本，均不入 Git。`sdk:verify` 检查正式依赖、网页部署副本的文件哈希及双方包内来源信息；禁止混用新版头文件和旧静态库。安装接受正式 GitHub Release manifest 的 HTTPS URL 或本地配对 manifest 路径。安装默认重放锁文件；版本更新、缓存和回滚见 [SDK-DOWNLOAD.md](SDK-DOWNLOAD.md)。nlohmann/json 是编辑器自己的序列化依赖，已随仓库保存在 `third_party/nlohmann-json/`，不属于渲染扩展。

## nova-render 负责

- 静态多实例、共享资产、世界矩阵、原始空间和资产包围盒。
- 完整相机姿态、透视/正交、FOV/裁剪、帧缓冲视口。
- BVH 射线拾取、包含/排除过滤、实例 ID、世界命中位置/法线/距离。
- 多材质槽、颜色/PBR 因子/贴图的运行时修改。
- GPU BVH 方向光硬/软阴影、投影标记、采样质量和偏移。
- 线性/指数平方雾、环境加载与清除。
- 可选 UI 初始化/绘制/逻辑像素视口回调、窗口 Escape 策略。

旧 CPU 阴影深度图与私有 shader/源码补丁已退役；对应实现测试属于 nova-render，编辑器通过真实渲染验收消费结果。当前配对原生包验证了 macOS Metal 和 Vulkan（MoltenVK），网页验证 Chrome WebGPU；不代表完成 Windows/Linux 真机运行验证。

## nova-editor 负责

项目与层级、隐藏/锁定策略、选中与 gizmo、导航与视图立方体、吸附与摆放、资产版本、保存/ZIP/恢复、撤销重做，以及 UI 布局。

`RenderBridge.hpp` 与 `packages/render-contract/bridge.ts` 只把编辑器的导航和项目环境字段转换为正式 SDK API，不实现渲染算法。旧项目仍按原格式读取：旧归一化空间、sourceSpace 原始空间和环境资源路径均保留。

材质面板先调用正式运行时槽接口，再保存不可变 GLB 资源版本，使共享实例预览与保存、撤销、恢复一致。SDK 支持多槽；编辑器仍可把模型拆成独立子节点，保留既有材质编辑语义。

编辑器主相机面板已接入垂直 FOV、近远裁剪及滚转，保存格式 v5；桥接层转换到正式 Camera API，投影、视图立方体与辅助线使用相同镜头参数。旧相机按 45° / 0.01–200 默认值读取。点光、聚光与多方向光叠加不在本次范围。

## 验收

- `pnpm test`、`ctest`：业务数据、历史、源空间、相机投影和项目恢复。
- 原生 GPU：拾取、摆放、原始单位、环境/雾切换，720 帧布局/相机/模型/材质场景回归。
- 启动 `pnpm dev:web -- --port 5223` 后执行 `pnpm test:browser`：真实 UI 材质/贴图修改、正交与顶视图、阴影、环境移除、两种雾和 ZIP 保存恢复。
- nova-render 自身另外覆盖硬/软阴影像素、castShadow 与移动、所有 AA 和 native/Web 拾取一致性；编辑器不再维护这些算法的私有源码副本。

## 下一步：点光、聚光与多灯

需求与双端 API 提案见 [SDK-LIGHTS.md](SDK-LIGHTS.md)。当前锁定 0.2.0 不具备灯光集合能力；由 nova-render 提供数据/集合接口、真实多灯照明、能力与阴影限制，再由编辑器接入节点、属性、辅助显示及项目迁移。文中的接口名是待确认提案，不是现有 SDK API。

## 0.3.0 scene lights

Formal `SetLights` / `setLights` and capability queries now own simultaneous directional/point/spot illumination, shared HLSL attenuation, cone falloff and per-directional-light BVH shadows on Metal/WebGPU raster. Point/spot shadows are explicitly unsupported; other native backends and ray tracing keep the legacy directional API. The editor owns independent node flags, hierarchy transforms, range/cone helpers, UI, scene v6 migration, history and serialization; it does not implement or patch lighting shaders. Exact package provenance is pinned in `nova-sdk.lock.json`.

## 0.4.0 backend extension

The same scene-light API now accepts Metal, Vulkan and DX12 raster backends. WebGPU semantics remain unchanged. Metal/Vulkan runtime and shader DXIL compilation are verified; Windows runtime validation is deferred and this release contains no Windows SDK. Native editor `--api` selects the backend without introducing editor-owned rendering. Directional BVH shadows remain supported; point/spot shadows and ray-tracing light collections remain unsupported.

## 0.5.0 local-light shadows

The formal SDK owns finite-distance point/spot BVH visibility, hard/soft filtering and truthful capabilities. Both editor UIs expose the same per-light shadow flag and softness without shader patches. Scene v7 records newly enabled local-light shadows; legacy documents preserve their previous flags. Windows runtime validation remains deferred.
