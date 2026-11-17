# Nova Editor 工程规划

更新：2026-11-16。状态：第一阶段已调整为对齐 three.js Editor，现有双端场景树、摆放和保存恢复作为基础，完整功能仍在推进。默认桌面优先 macOS ARM64、Windows x64；网页优先具备 WebGPU 的桌面浏览器。Linux、移动浏览器后续加入验证矩阵。

## 渲染分工与依赖接入

以 [SDK-OWNERSHIP.md](docs/SDK-OWNERSHIP.md) 为当前分工：nova-render 负责实例/原始空间、完整相机/视口、射线查询、运行时材质、场景阴影及雾效；nova-editor 负责层级/TRS计算、选择与gizmo策略、资产编辑、项目持久化和 SDK 版本管理。通用调试绘制和窗口/UI挂钩由库提供，布局和显示/输入策略由编辑器决定。

已接入 nova-render 0.3 配对包，原生/Web 依赖由版本、干净源码提交与 SHA-256 固定，旧实例、拾取、阴影、雾与 UI 私有补丁已退役。编辑器不再编译或修改渲染器源码；`RenderBridge` 只映射既有导航和项目字段到正式 API。库的渲染实例仍不充当编辑器文档/ECS。当前依赖来自正式 GitHub Release 0.3.0；由配对 manifest、源码提交与文件校验锁定。已验证状态见 `packages/render-contract/migration.json` 和 `docs/SDK-OWNERSHIP.md`。

## 目标与范围

第一阶段以 [three.js Editor](https://threejs.org/editor/) 的完整场景编辑工作流为功能基准，而不是仅完成静态 GLB 摆放。桌面 C++/ImGui 与网页 React 分别实现，同一场景格式、命令语义和验收项目；渲染仍由 Nova SDK 提供，不引入 Electron、Qt 或 WASM。

第二阶段扩展为 Hazel 式游戏编辑器：游戏运行时、输入行为、物理、音频/UI、Prefab 工作流、游戏构建与独立运行。three.js Editor 已有的基础脚本、Play/Stop、动画控制和场景发布归入第一阶段，不再整体推迟到第二阶段。

### 布局基准

2026-11-15 实际检查线上编辑器，页面显示 autosave r187。以本次界面和官方 editor 源码为参考快照，不自动追逐上游后续变化。

- 顶部紧凑菜单：文件、编辑、添加、视图、渲染、帮助；自动保存状态放右侧。减少常驻大按钮与文字说明。
- 中央大视口占主要空间，移除固定左侧场景树。相机和显示模式在视口右上，方向辅助保留在视口内，变换模式使用快捷键切换，不放常驻工具条。
- 右侧统一侧栏：场景 / 项目 / 设置。场景页上方是可调整高度的场景树，下面是场景设置及选中对象属性。
- 属性按对象 / 几何体 / 材质 / 脚本组织，按对象能力显示相关页；相机和灯光显示对应属性，不显示无效网格属性。
- 底部是紧凑的动画播放、时间与速度控制。现有 Nova 资源库保留为可收起抽屉，默认不长期占用一整条高面板。
- 保留用户确定的中性黑白 UI、灰色场景背景和 Nova 视图立方体。参考布局和信息组织，不替换渲染器。

### 第一阶段功能对齐清单

这些条目是目标，不代表已完成。除设备相关渲染能力外，桌面与网页均进入验收；接口尚缺时由 nova-render 提供公开能力，编辑器接入并验收，禁止用无效控件冒充完成。

1. 文件与项目：新建、打开、保存、导入、对象/场景导出、自包含发布包、自动保存与恢复。导入格式、导出格式建立逐项清单；先完成 GLB/glTF 与图片，再补参考编辑器支持的其他格式，不将“只支持 GLB”称为完整对齐。Nova 原生项目格式保留；不默认承诺兼容 three.js 内部 JSON/代码。
2. 对象与几何体：空节点、分组、基本几何体及参数编辑、模型内部节点/子网格访问、对象属性、局部/世界变换、多选群体操作、复制/删除/居中、层级与可见性、辅助显示。包括参考 Add/Mesh 中的各类参数几何体，分批验收，避免只做立方体就标记完成。
3. 相机与灯光：透视/正交相机节点、主相机、FOV/裁剪面、相机预览与辅助线；方向光、环境光/半球光、点光、聚光等对象的属性、可见辅助体和相应阴影能力。具体光源以参考快照的 Add/Light 清单核对。
4. 材质与纹理：材质槽、共享/独立材质、颜色与纹理、PBR 参数、透明/裁剪、单双面、法线/自发光等适用属性及保存恢复；材质类型与高级/自定义着色能力逐项对应 Nova 支持情况，不能把不支持的类型静默映射成同一种材质。
5. 场景与渲染：背景色/图片/全景背景、环境贴图、线性/指数雾、曝光/色调映射、抗锯齿、阴影，以及真实/实体/法线/线框等显示模式。参数区分场景内容与编辑器视图状态；保存后跨端恢复。
6. 动画与基础脚本：动画片段、播放/暂停/停止、时间定位、速度；对象脚本编辑、生命周期和输入事件、错误定位；Play/Stop 使用隔离运行状态。跨端脚本需统一宿主 API，不能直接依赖浏览器 DOM 或 Node。执行引擎先做原生/Web 原型验证，不照搬 three.js 对象 API。
7. 预览、发布与输出：脱离编辑器的场景 Player、自包含可发布场景包、图像输出、动画/脚本驱动的视频输出。支持时提供相应栅格/路径追踪输出，按 Nova 设备能力显示，格式和能力限制明确。浏览器生成 Web 发布包；桌面原生包由桌面/CLI 工具链生成。
8. 项目/编辑器设置：渲染配置、项目标题和发布选项、资源统计、语言/快捷键、历史浏览、网格/相机/灯光/骨骼辅助开关、操作帮助与统计信息。

第一阶段验收：从空项目添加几何体并导入模型，组织层级、编辑几何参数/材质、布置多类灯光和主相机、配置环境与雾；加入动画或基础脚本并预览；保存重开、双端互通，再发布为独立场景并输出图像/视频。逐项记录已实现、部分实现、未实现和平台限制，不以外观相似代替功能验收。

### 接下来的实现批次

- A：双端布局重组（基础布局已实现）。菜单 + 大视口 + 右侧统一侧栏 + 可收起资源抽屉，保留现有功能入口和恢复保护；新增功能实现前不摆放可点击的空入口。
- B：对象/几何体与材质。参数几何体、模型内部结构、真实材质槽编辑、多选群体变换。
- C：持久化相机/灯光/环境/雾与渲染配置；推进必要的 Nova SDK 公开接口。
- D：动画与基础脚本、Play/Stop、独立 Player 和场景发布。
- E：图像/视频输出、补齐导入导出与几何/材质类型、设置与跨端验收，关闭参考快照的剩余差距。

A 的菜单、大视口、统一右侧栏、可收起资源抽屉已实现；B 已完成六种参数几何体与资产级 PBR/贴图编辑；静态 GLB 内部层级、子网格变换与独立多材质槽已接通，多选整体 TRS、局部/世界 gizmo 与数值坐标切换已接通，其余几何类型仍待补齐，后续继续 C。动画播放控制随 D 接入，D/E 同属第一阶段。完整游戏制作、物理系统、完整 Prefab、游戏构建管线及发布体验仍是第二阶段。

参考源码：[侧栏](https://github.com/mrdoob/three.js/blob/master/editor/js/Sidebar.js)、[对象/几何/材质/脚本属性](https://github.com/mrdoob/three.js/blob/master/editor/js/Sidebar.Properties.js)、[添加对象](https://github.com/mrdoob/three.js/blob/master/editor/js/Menubar.Add.js)、[导入](https://github.com/mrdoob/three.js/blob/master/editor/js/Loader.js)、[预览/发布](https://github.com/mrdoob/three.js/blob/master/editor/js/Sidebar.Project.App.js)、[图像/视频渲染](https://github.com/mrdoob/three.js/blob/master/editor/js/Menubar.Render.js)。

## 当前事实与风险

检查来源为相邻 nova-v2 工作区：render/include/render/{Renderer,Window,RenderMode}.hpp、web/src/Nova.js、cmake/{Install,NovaConfig.cmake.in}、scripts/webgpu/generate.mjs、package.json。

- 已有 CMake 安装与 Nova::Render 导出，以及本机 libnova_render.a。安装还处理 GLFW、volk、可选 ImGui 和许可文件。不能只复制一个静态库。
- 原生 Renderer 构造依赖 GLFWwindow*；Window 是完整独立窗口封装。公共接口注明主线程与单 Renderer 限制。尚未看到原生宿主 surface、离屏视口与通用 UI 集成契约。
- Web 侧为独立 JavaScript / WebGPU 实现，明确与 C++ 共享概念而非二进制；loadModel 会替换当前模型。原生公共接口也没有暴露编辑器需要的多实例增删改与拾取。
- 已有相机、环境、光照、动画、渲染模式和能力查询。Web shader 生成目前绑定文档生成目录，尚无独立可发布的渲染 npm 包；根 package.json 是私有文档包。
- 检查时 HEAD 短哈希为 8a231ab，但工作区有未提交改动。现有 build 下安装目录不可据此认定来自同一提交或已可发布；需要重新建立产物追溯。

上述为代码检查结果，没有在本任务重新编译或验证任何渲染后端。

## 已确定的技术路线

用户已确定：桌面 C++ + GLFW + ImGui，链接 Nova 原生预编译 SDK；网页 TypeScript + React，接入 Nova JavaScript/WebGPU。**不引入 Electron、Qt 或 WASM，不追求共享 UI 代码。**

两端共享场景 schema、命令语义、坐标与资产约定，以及验收样例。C++ 与 TypeScript 分别实现编辑逻辑，使用相同 fixture 验证行为；包升级同时验证两端。

本次已给 Nova ParameterPanelConfig 增加 drawUI 与 showBuiltinPanel，应用在 SDK 已建立的 ImGui 帧内绘制自定义 UI；渲染器修改推迟到 DrawFrame 返回后。此扩展影响 C++ ABI，安装包与消费者必须同步重建。

原生版通过 ParameterPanelConfig.sceneViewport 提供中央逻辑像素矩形，SDK 映射为 framebuffer viewport/scissor；投影、拾取和 gizmo 使用同一区域。目前仍共享窗口 framebuffer，尚未实现可停靠的离屏 viewport texture。网页使用独立 canvas。两端均通过 SetScene 接入多实例栅格渲染，场景变换实时驱动画面。

## 工程边界

Nova-v2 与 nova-editor 保持独立仓库。Nova 负责渲染与 SDK 发布，Editor 仓库内部用 pnpm workspace 组织应用与公共包：

```text
apps/web/                    网页入口与部署
apps/desktop/                C++ 场景核心、GLFW/ImGui 编辑器
apps/web/src/                React 布局、场景树、Inspector、快捷键
packages/editor-core/        命令、事务、选区、历史记录
packages/scene-schema/       项目/场景 schema、校验、迁移
packages/asset-system/       资产 ID、引用、导入任务和缓存键
packages/platform/           文件系统、对话框、日志、任务服务接口
packages/render-contract/    编辑器依赖的最小渲染契约
packages/render-nova-web/    Nova Web 包适配
apps/desktop/src/            原生渲染适配与 C++ 编辑逻辑
CMakeLists.txt               原生应用构建，find_package(Nova CONFIG)
tools/sdk/                   下载、哈希校验、解包、诊断与本地覆盖
tests/fixtures/              小型场景、资产及迁移回归样例
docs/decisions/              架构决策记录
nova-sdk.lock.json           原生/Web 关联发布信息；自定义工具读取
```

pnpm 管 JS/TS 依赖；CMake 消费原生安装包；vcpkg 主要留在 Nova 上游构建依赖。首期不同时引入 Conan 和自定义 vcpkg registry，避免三套原生依赖来源。已有预编译 SDK 可以直接通过精确路径消费，不需要为了包管理重新编译 Nova。

## 场景与渲染契约

Editor 的 SceneDocument 是编辑真相来源，渲染器持有可重建的投影。渲染器重启或切换适配器后，可由文档与资产重新构建视图。相机导航等临时状态与可保存相机区分，选区与面板布局不进入运行场景。

Node 具有稳定 UUID、父子关系、本地 TRS、组件；资产通过 assetId 引用。世界矩阵由层级推导；明确右/左手、轴向、单位、四元数顺序、矩阵存储约定、角度单位及颜色空间，并在导入边界转换。重设父节点明确是否保持世界变换，拒绝循环引用。

渲染适配契约拟包括能力查询、资产上传/释放、实例创建/销毁、变换更新、材质覆盖、相机/灯光更新、拾取、调试线/选择显示、视口生命周期与错误事件。SetScene、PickScene、基础 gizmo 和撤销事务现已实现；材质覆盖、GPU 调试绘制和独立视口生命周期仍待补充。

先支持一个视口，多个对象共享 mesh/texture 资源。模型资产资源与场景实例句柄分离；重载资产更新相关实例。拖动 gizmo 实时更新渲染，鼠标释放时只提交一个可撤销事务。拾取结果包含稳定对象映射与请求版本，丢弃旧帧/已删除对象结果。

GPU 拾取与选择轮廓可由 Nova 提供；当前使用包围盒宽阶段加真实三角形的 CPU 射线拾取。多实例独立变换与正确渲染是 MVP 的必要条件，不能以静态单模型预览代替。

## 项目与资产格式

项目包含 project.json、scenes/*.scene.json、assets/ 与资产元数据；生成缩略图、导入产物、shader 缓存放入可删除缓存目录。项目与场景各带 schemaVersion，资产带源文件 hash、导入选项与 importerVersion。

保存使用临时文件加替换或具备同等恢复能力的事务；迁移保留备份，遇到高于支持范围的 schema 拒绝覆盖。渲染 SDK 版本、场景格式版本和资产导入器版本独立演进。

第一版网页必须能导入并导出自包含项目归档；本地目录读写作为能力增强，不能假设所有浏览器都支持。网页内部由虚拟文件系统统一 assetId 与 Blob URL，卸载后释放 URL；桌面同样不把绝对本机路径写进场景。目录导入/归档解包需要规范化路径、防止越界与大小失控。

## Nova SDK 发布与包管理

一次 Nova 发布建立不可变 releaseId，关联：源码完整 commit、原生安装归档、Web npm 包、生成 shader、许可证、变更说明与 SHA-256 清单。平台产物可以有不同构建号，但必须追溯到相同源码与协议版本。官方可复现发布只来自干净提交。

原生包按 OS、架构、编译器/运行库 ABI、Debug/Release、后端 features 区分；Windows 明确 MSVC toolset 与 CRT，Linux 明确 libc/最低系统基线，macOS 明确部署目标。Debug/Release 配置映射不能靠文件名推测。记录公共 API、资源格式与 shader 布局版本。

Web 包建议单独发布为 @nova/render-web，提供 ESM、类型声明、exports 和预生成 shader 资源；不夹带文档站与样例大型模型。Editor 安装后即可运行，不要求 DXC、Naga 或本地 HLSL 服务。包名是提案，发布前需要确认命名空间权限。

第一阶段原生分发使用 Release 附件或私有对象存储 + 清单。tools/sdk 根据 nova-sdk.lock.json 下载、校验、解包到忽略提交的可见 `deps/nova/` 安装目录，使用 CMAKE_PREFIX_PATH 定位包。可搬迁安装包必须在无 Nova 源码、无原始 build 路径环境进行外部 consumer 构建验证。

锁文件应包含 releaseId、full commit、协议版本、Web 精确版本、各原生 target 的 URL/hash/ABI/features。pnpm-lock.yaml 仍锁定实际 npm 完整性；自动检查二者关联一致。CMake 的版本兼容声明不等于 ABI 保证，Editor 默认使用精确已验证版本。

0.x 阶段也遵守规则：破坏公共契约升级 minor，兼容修复升级 patch；不使用 latest、浮动分支或同版本覆盖包。预发行通过 dev/rc 渠道区分；stable 仅表示通过明确消费测试的组合。

## 持续迭代流程

Nova 干净提交 → CI 构建原生/Web 同批 SDK → SDK 自测与外部 consumer 检查 → 发布候选版本 → Editor 提交专门升级变更 → 双端集成验收 → 合入编辑器。失败保留旧锁文件，可直接回滚适配层和版本。

开发联调允许 NOVA_SDK_ROOT 指向本机安装前缀，Web 使用显式本地包覆盖。此模式显示 dev 来源，不能改写团队锁文件；工作区 dirty 的包记录源码状态摘要，只用于本地验证。Editor 普通构建不能偷偷执行相邻 Nova 源码构建。

先引入自动构建与升级检查，再决定是否使用机器人提交升级 PR。不自动把 Nova main 的每次改动带进 Editor stable。适配层吸收接口名称/参数变化，核心 UI 不直接调用 Nova 私有实现。

## 开发顺序与验收

以本文“第一阶段功能对齐清单”和 A–E 批次为当前顺序，替代最初的静态场景 MVP 范围。SDK 版本可追溯、无 Nova 源码的外部消费、平台构建和安装包仍是贯穿各批次的工程任务。

当前基础已包括：双端多实例/TRS、点选和 gizmo、撤销重做、层级树/分组/排序/隐藏锁定、项目归档、保存/恢复、表面摆放、正交视图、摄影棚光照与 Metal/WebGPU 阴影。它们只是完整参考范围的一部分；完整几何类型、顶点/拓扑编辑、完整光源类型、相机镜头参数、环境/雾、动画/脚本和发布等尚未完成。

每批次提供真实运行验证与可运行构建；场景迁移、历史记录、导入失败/取消、丢失资产、GPU 渲染、保存往返和运行时状态隔离均有对应验收。发布必须包含真实设备验证，跨后端图像比较使用容差，不要求位级相同。

## 开工准备

需要先落实：首批平台与最低系统/浏览器、SDK 发布位置与权限、Nova API 变更责任、包命名、桌面签名凭据的管理方式，以及一组可再分发的小型测试资产。默认采用本文件的平台与 GLB 首版范围即可启动 P0；签名和公开托管可以在发布阶段接入，不阻塞本地开发。

## 当前实现与后续工作

当前可运行入口、缓存准备方式和能力限制见 README.md，实测记录见 docs/VALIDATION.md。本文列出的模块目录包含后续拆分规划；当前 TypeScript workspace 已建立 web、scene-schema、editor-core 与 render-contract，原生核心和 UI 位于 apps/desktop/src。

多实例、TRS、拾取、gizmo、层级工作流与恢复已接通；参考布局的双端基础重组已完成，已加入六种参数几何体和资产级 PBR/贴图编辑，B 批次仍未全部完成。正式 SDK 配对包与 GitHub Release 下载、版本锁定、显式升级已接入，见 SDK-DOWNLOAD.md；CI 自动升级提案尚未接入。

### 参数几何体与材质的当前实现

SDK 未提供过程网格或实例材质覆盖接口，编辑器分别以 TypeScript/C++ 编译标准静态 GLB。两端共享夹具定义参数范围、三角形数、法线/UV 和 PBR 语义。参数位于 `extras.novaEditor`，纹理以内嵌 bufferView 保存，SDK 和场景 schema v2 均不修改。

每次应用生成 UUID 资源路径，以一次历史命令切换 asset.path；撤销版本保留在资源存储中。复制节点共享资产，Make unique 先分离资产记录，之后编辑互不影响。几何参数重建保留 PBR 及嵌入图片。旧整体资产的材质修改仍统一作用于其各 primitive；新导入或手动展开的模型，每个 primitive 对应独立单材质资产和可编辑子节点，从而支持多材质槽。正式资产版本回收与压缩属于后续工程任务。

### 静态模型展开与独立材质槽

`packages/asset-system/model.ts` 与 `apps/desktop/src/ModelEditing.hpp` 负责相同的转换：原 GLB node → 编辑器层级节点，mesh primitive → 单材质 GLB 与子网格节点。SDK 仍以单材质资产实例渲染，多个 primitive 不再必须共享 PBR 因子和图集。无需修改 Nova SDK、锁文件或场景格式；使用既有节点命令及 gizmo、真实三角形拾取、阴影和资源历史。

转换前校验可达层级、TRS/矩阵、原始顶点边界及支持范围。glTF 局部变换逐层保留，镜像和非等比缩放支持；矩阵包含剪切时拒绝而不改变外观。旧归一化资产用源坐标全模型边界生成中间归一化节点，外层实例 TRS 保持不变。

同一 mesh/primitive 多次出现仍共享资产。各 primitive 的原始材质与引用图片分别打包，通过 accessor、bufferView、texture、image 索引重映射移除无关内容。不同 primitive 的同名材质当前也分离；全局独立材质库、跨不同网格重新绑定共享材质、原始单 GLB 重组导出和顶点拓扑操作不在本批实现中。未来可在现有槽节点上引入材质资源 ID，保持持久化迁移明确。

桌面先将全部子资源写入新路径，再提交一次场景历史；失败不会发布部分层级。网页一次命令提交层级，并把对应字节保留到撤销/重做资源存储。展开后不再被引用的原整体资产从当前文档移除，历史仍保留原文件供撤销。正式资源版本回收待后续实现。

### 多选整体变换

`selection-transform.ts` 与 `SelectionTransform.hpp` 共享 `selection-transforms.json` 验收夹具。先消除已选父节点下的重复子选择，检查锁定后代及父级可逆性。多根选择轴心取可见模型联合世界 AABB 中心；单根选择使用节点原点。局部正交轴架由活动节点祖先的旋转链组成，排除缩放/镜像对轴向长度的影响；世界轴架为单位旋转。

将现有射线 gizmo 驱动的临时父坐标架和单位子节点映射成增量 D。冻结起始场景、轴架 B 和根世界矩阵 W，计算 `newLocal = inverse(parentWorld) * B * D * inverse(B) * W`。先为所有根求出可表达的 TRS，再一次性更新草稿；出现剪切、奇异变换或锁定则整次取消。实际层级不创建临时分组节点，不修改 SDK 或场景 schema。选择范围的后代继续由世界矩阵继承。

网页与原生均使用历史预览事务，拖动结束一个命令；取消还原全部根，单位增量保留原始 TRS，避免浮点分解导致空操作清空重做。坐标切换不进入历史，并取消正在进行的拖动。单选数值页使用同一坐标选项，世界数值经父逆矩阵转换到持久化局部 TRS；多选数值为一次提交的相对轴架增量。

### 场景组件与主相机 — 2026-11-16

场景 schema v3 增加互斥的 `node.camera` / `node.light` 组件，保留现有 TRS、层级及 asset 引用布局。语义校验拒绝非法数值、非方向光类型、重复主相机或活动光标记；v1/v2 禁止这些新组件，仍可读取。创建首个组件自动标为主/活动，切换为一次历史命令；复制组件清除主/活动标记，删除后不留下悬空全局引用。几何体创建和模型展开保留已有 v3 版本。

双端 `scene-objects.ts` / `SceneObjects.hpp` 将节点世界位置和祖先旋转链转换为现有 Nova DirectionalLight 与 OrbitCamera。相机通过 position、backward 和目标距离导出 yaw/pitch/target；正交高度反算 distance，曝光原样传递。朝向忽略对象缩放，位置保留完整父级矩阵。垂直 FOV、近远裁剪和滚转已通过正式 Camera API 接入，投影、射线及视图立方体使用相同镜头参数。v5 保存镜头，旧相机回退 45° / 0.01–200；滚转沿用节点四元数，不重复保存角度。

活动方向光的线性颜色、强度、阴影设置驱动 SDK；隐藏活动光只将直射强度设为零并关闭阴影。无活动光才回退当前会话的摄影棚设置，内置环境补光仍由 SDK 提供。多节点可存储，当前同时激活一个方向光；点光、聚光、环境节点与多光源叠加需要上游公开能力。

主相机预览与编辑视角分离：预览使用场景组件，暂停视口导航/gizmo 和辅助体；退出恢复原编辑相机。节点和组件的编辑仍是文档命令，可撤销与持久化。示意辅助体由编辑器投影成 SVG / ImGui 线段并按屏幕中心标记点选，避免将灯光/相机伪装成 GLB 实例或阴影投射物。

浏览器数字变换按失焦/Enter 提交，避免场景重绘中断逐字符输入。项目页提供直接下载 ZIP；文件选择器因 SecurityError/NotAllowedError 不可用时同样回退下载，用户取消仍取消。下载路径保持 dirty 与恢复副本，只有 writable.close 成功才确认保存。异步场景绘制不覆盖保存结果提示。

### Release 依赖获取与锁定

`sdk:install` 重放锁文件，`sdk:update <精确版本>` 显式选择同版原生/Web 配对包。候选包经 GitHub Release 元数据、清单和包内来源校验后事务安装；下载缓存位于 `.cache/nova/`，以 SHA-256 为键，支持离线重装。网页构建前验证哈希清单，原生配置检查版本与提交。JSON 头文件是编辑器独立的 vendored 依赖，不混入 Nova SDK 缓存。详见 [SDK-DOWNLOAD.md](docs/SDK-DOWNLOAD.md)。

### 相机镜头与滚转 — 2026-11-16

应用镜头或捕获相机升级至v5，其他命令保持版本。新增FOV/裁剪字段必须一起出现，有限数且远大于近。世界位置继承完整父变换，朝向只继承旋转链。捕获时分别求父世界矩阵的逆用于位置、父旋转链的逆用于朝向，避免非等比缩放造成剪切误判。roll从四元数提取；极点可能显示等价的Euler角，但渲染姿态不变。

### 可见的 SDK 安装布局

正式依赖源统一在 `deps/nova/native`、`deps/nova/web` 和 `deps/nova/package`，与下载状态 `.cache/nova` 分离。锁格式v4记录可见路径，文件哈希和发布版本不因迁目录改变。Web部署副本从正式Web包产生，完整校验与事务更新独立于上游渲染实现。CMake对旧默认根及包查找缓存做定向迁移，显式外部根不强制改写。
