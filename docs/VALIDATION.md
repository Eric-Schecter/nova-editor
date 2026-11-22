# 0.2 正式 SDK 接入验收（2026-11-16）

当前配对包来源为 `9c133a259c75f619bc0631188c56fb69116d8089`，`sourceDirty=false`，原生 UI 已开启。249 项安装文件哈希及 native/Web 包内来源校验通过；不再使用任何私有渲染扩展或源码补丁。

- 58 项 TypeScript/业务测试、8 项原生 CTest、TypeScript 检查、网页生产构建通过。
- 原生 GPU：Metal/Vulkan 拾取，120 帧原始空间/视口，120 帧摆放/光照/阴影，90 帧环境/雾与清除，720 帧编辑器布局/相机/模型/材质场景；GPU 验证错误为 0。
- Chrome WebGPU 实际 UI：导入双材质模型，颜色/金属度/粗糙度和 PNG 贴图修改，正交/精确顶视图，阴影切换，环境加载/移除，线性/指数平方雾，项目 ZIP 保存恢复。截图与归档在 `output/formal-sdk-browser/`。
- 现有 Helmet／Avocado 三实例工程：网页生产构建加载及截图通过；桌面 Metal 实际加载 5 帧，验证错误为 0。多材质图集按 512 MiB 预算自适应，防止辅助体加入后超限。
- 最终配对包再次通过独立 C++ Metal/Vulkan 与 npm/WebGPU 消费项目安装、材质及环境 API 验证。
- nova-render 自身验证了 GPU 硬/软阴影像素、取消投影和移动，以及原生/Web/AA 部分雾混合的颜色一致性。编辑器不再依赖旧 CPU 阴影和私有拾取函数的实现测试。
- 原生当前验证范围为 macOS ARM64 Metal 与 Vulkan/MoltenVK；网页为 Chrome WebGPU。DXIL 编译通过，但未声称完成 Windows/Linux 真机运行验证。

## GitHub Release 安装验收（2026-11-16）

- 发布 `v0.2.0`：C++ macOS ARM64 SDK、Web npm 包、配对 manifest 和 SHA256SUMS；源码仍为上方干净提交。
- 实际执行 `pnpm sdk:install https://github.com/Eric-Schecter/nova-render/releases/download/v0.2.0/manifest.json`，下载并安装 249 个文件，`sdk:verify` 通过；锁定来源为 `github-release`。
- 下载来源校验拒绝非官方或 HTTP URL，失败不改变现有锁文件。
- 从 Release 安装后，58 项业务测试及网页材质、贴图、相机、阴影、环境/雾效、项目 ZIP 恢复和 Helmet/Avocado 真实工程回归通过。

以下是迁移前的历史记录，其中私有 SDK 标记和补丁路径已退役，不作为当前安装说明。

---

# 初版验证记录 — 2026-11-14

## 光照设置面板 — 2026-11-15

- 双端增加检查器 Object/Lighting（对象/光照）标签及工具栏入口。支持光照启用、方位角/高度角、sRGB 颜色与 Hex 输入、方向光强度、独立阴影开关、柔和度和恢复默认值。与场景文档、选择和撤销历史分离，当前会话设置不写入项目。
- SDK 新增 SceneShadowSettings 与 SetShadows/GetShadows，避免与已存在的独立 ShadowView 示例类型冲突。阴影 uniform 扩展到 96 字节；Metal/WebGPU 使用同一 5×5 可调 PCF 及接收面梯度修正。开关/柔和度不重建深度图，关闭阴影时不进行深度图更新。修复 Web 实例缓冲扩容时重复分配阴影缓存的问题。
- 网页实际调整方位角到 0°、高度角 45°、颜色 #ffb86b、强度 5 和柔和度 4，场景明暗、色调和投影方向正常变化；独立关闭阴影后仍保留光照，柔和度控件禁用。验证柔和度 0、关闭全局光照、恢复默认值，默认光向/白色/3.5/阴影开启/柔和度 1 均恢复。撤销按钮保持禁用、项目未变脏。截图 output/lighting-settings-web.jpg、output/lighting-warm-web.jpg。
- 桌面独立新预览中实际打开 Lighting 面板，并通过滑块改变方位角、强度和柔和度，场景同步变化。桌面颜色输入及恢复按钮的后续自动点击受 noWindowsAvailable/捕捉服务错误阻挡，未记为已完成手势验收；颜色转换、设置恢复逻辑和渲染接口由测试与网页实测覆盖。
- stacking_render_test 在 Metal API Validation 下切换光向/颜色/强度、硬阴影、柔阴影、关闭阴影，并检查设置读回及非法柔和度拒绝，120 帧、validation errors: 0。35 项 TypeScript 测试、2 项 CTest、类型检查、双端构建通过；SDK 212 个文件校验通过，新增 scene-light-settings-v1。
- 开发热更新触发旧 Chrome 页面重载提醒；自动审批拒绝确认重载，以免丢失未保存场景。已取消重载、保留旧页面，并另开独立验收页完成全部网页检查；未修改用户权限或放弃旧场景。

## 地面与模型间阴影 — 2026-11-15

- macOS Metal 与 WebGPU 接入共用方向光阴影：真实三角形 CPU 深度光栅化、1024² 缓存、GPU 3×3 PCF 和接收面斜率偏移。支持模型到地面、模型到其他模型的遮挡，旋转/缩放/父子变换使用有效世界矩阵；镜像双面绘制，奇异实例不投影。
- 增加 40×40 米灰色单面地面接收层，避免极薄双面箱体的深度闪烁。原点保持 Y=0，接收层置于 Y=-0.005。所有辅助对象、未引用资源的退化实例均 castShadow:false，不进入阴影范围、场景树或导出。
- Chrome 实际检查：立方体和立柱的地面阴影；立方体位于 [0,4,0.5] 时投影到三米立柱顶面；一键落地到 Y=3 后阴影同步变化；撤销恢复 Y=4 及相应投影。关闭/重开光照显示正常。修正接收面斜率偏移后重新检查，模型面上的自阴影条纹消除。截图 output/shadows-web.jpg、output/shadows-stack-web.jpg。
- 桌面实际打开同一三模型场景，检查地面投影与立柱顶面阴影，截图 output/shadows-native.jpg。最终原生编辑器在 Metal API Validation 下加载 output/shadow-study/project.json 运行 120 帧，validation errors: 0。
- 32 项 TypeScript 测试、2 项 CTest、类型检查及双端构建通过。新增阴影深度测试覆盖地面/低处接收面遮挡、高处不遮挡、光向变化、空场景、非法光向、辅助对象排除、实例变换更新和相机重绘复用缓存。
- SDK 已重新编译、安装并暂存，207 个锁定文件校验通过，新增 scene-shadow-map-metal-web-v1；变更保存在 docs/nova-scene-shadows.patch。Web 模型、天空及 AA/motion 的六个 shader 包同步生成。
- 自动审批拒绝了批量修改 Vulkan/DX12 并安装的原方案，因此最终实现限定 Metal/WebGPU；Vulkan/DX12 四个源文件逐字节核对与任务前相同，HLSL 条件编译保留原有行为。这两个后端的阴影尚未实现。
- 当前单张方向光阴影贴图适用于基础静态场景摆放；大场景精度、高面数多实例 CPU 更新成本、级联及透明阴影不在本次实现范围。

## 默认视口光照 — 2026-11-15

- 双端默认使用现有 SDK 的 PBR 模式、白色方向光（方向 [-1, 1.6, 2]，强度 3.5）和内置摄影棚环境补光。关闭环境背景显示，保持原来的灰色视口，无需导入 HDR；本次未修改 SDK。
- 网页“默认光照”和桌面“Lighting: On/Off”切换 PBR / Unlit，作为视口设置，不写入场景节点、项目文件或撤销历史。
- Chrome 实际检查尺寸示例：立方体和立柱有清楚的顶面、正面和侧面明暗；实际关闭、重新打开光照，撤销按钮仍禁用、项目未变脏。截图 output/default-lighting-web.jpg。
- 编辑器原生构建、TypeScript 检查、Vite 生产构建通过。实际原生编辑器在 Metal API Validation 下加载尺寸示例并渲染 120 帧，退出 0，validation errors: 0；桌面开关手势未独立自动验收。

## 模型表面摆放与堆叠 — 2026-11-15

- 两端拖入实例时先以真实三角形命中定位 X/Z，再按网格吸附后的底面覆盖区域查找最高支撑。可连续叠放；无支撑回到 Y=0。新实例保持直立，不对齐表面法线。
- 一键落地向下检测支撑，排除自身及整个子树；带旋转、镜像和非等比父变换的组仍只沿世界 Y 移动。重复落地为 no-op，不增加历史；一次落地一条撤销记录。
- 原生回归暴露了重合底面先命中自身、跨过支撑面的错误；已在 Nova SDK 增加 includeIds/excludeIds，过滤先于最近命中选择，排除优先。重新编译安装原生包、暂存 Web SDK，锁文件新增 scene-picking-filter-v1，195 文件校验通过。最小上游补丁保存在 docs/nova-surface-picking.patch。
- Chrome 实际拖入小立方体到三米立柱上，Y=3；再拖入一个小立方体，Y=4。抬高到 Y=7 后，一键落地恢复 Y=4；再次落地后撤销仍直接回到 Y=7。实际验证 0.25 米吸附、顶视图拖入、多层堆叠和吸附越界后回落地面。截图 output/stacking-preview-web.jpg、output/stacking-web.jpg。
- stacking_render_test 使用已编译 SDK 的真实 GLB 和 PickScene，验证落到 Y=3、重复落地、重合支撑面的自身排除，以及透视/正交拖入第二层到 Y=4；Metal API Validation 下绘制 120 帧，退出 0，validation errors: 0。运行：MTL_DEBUG_LAYER=1 ./build/stacking_render_test tests/fixtures。
- 原生编辑器已用最新 SDK 重新构建并启动独立测试项目；当前原生点击自动化仍返回 noWindowsAvailable，未将桌面鼠标手势记为已完成验收。原生表面查询和变换结果由上述实际 SDK/GPU 回归覆盖。
- 30 项 TypeScript 测试、类型检查、生产构建、原生构建及 CTest 通过。新增测试覆盖真实 SDK 多层堆叠、单次撤销、斜面高度、包围盒内空白、窄支撑、子树排除和重合三角面的过滤优先级。
- 接触采用变换后 AABB 底面与每个候选支撑重叠区域的 3×3 射线采样。复杂凹形、细小凸起和旋转对象精确接触仍有近似限制；不提供刚体碰撞或稳定性模拟。

## 资源拖入与落地 — 2026-11-15

- 两端加入资源卡片拖入视口、线框包围盒/地面占位预览、世界 X/Z 网格吸附和一键落地。步长 0.1/0.25/0.5/1/2/5 米，Shift 临时反转；释放创建一个根实例与一条撤销记录，取消不修改历史。
- 落地只作用于 Y=0 平面，采用变换后资产局部 AABB 的最低点；组节点忽略空节点原点，转换世界竖直位移到父坐标系。旋转、镜像、非等比父变换、不可逆父变换及缺失边界都有回归覆盖。
- Chrome 实际验证拖入创建、网格开关/0.5 米步长、视口外释放、正交平行射线拒绝、Esc 取消、抬高后落地与单次撤销。删除某资产全部实例后，实际再次从资源库拖入成功。截图：output/placement-preview-web.jpg、output/placement-web.jpg。
- 原生新构建实际启动并检查资源库与吸附控件；CUA 原生拖动调用没有触发可观察的拖放结果，因此桌面物理拖放不计为 UI 验收通过。原生使用 ImGui 标准拖放源/目标，几何算法由共享夹具和 CTest 覆盖。截图：output/placement-native.jpg。
- 仅有两个未使用资源、零场景节点的项目在 Metal API Validation 下运行 120 帧，退出 0，validation errors: 0；证明资源缓存不依赖已有可见实例。
- 24 项 TypeScript 测试、类型检查、Vite 构建、原生构建与 CTest 通过；SDK 181 文件校验通过。本功能未更改 nova-v2 或 SDK。

## 基础搭景第一阶段 — 2026-11-15

- 新导入模型使用格式 2 / sourceSpace:true，保留 GLB 原始尺寸、根节点变换和原点。格式 1 与未标记资产保留归一化布局；格式 1 不允许 sourceSpace:true。项目 ZIP 打包、解包后 JSON 完全一致。
- 原生 sceneViewport 回调已接入 Metal/Vulkan/DX12 的 viewport/scissor。本机实际检查 Metal 中央视口、点选和 F 聚焦，画面和 gizmo 都按中央视口坐标显示；未实测其他系统。
- 两端增加 H 左键、中键、Shift+右键平移，F 聚焦选中子树，Shift+F/Home 全景；相机 target 不进入场景历史。源尺寸 Inspector 和实际资产边界选择框已实现。
- 两端实际载入同一份 1m 立方体与 2×3×1.5m 立柱场景，大小比例及地面位置正确。网页实际验证 F、H 平移、平移后的 gizmo 拖动、撤销与全景。截图 output/source-units-web.jpg、output/source-units-native.jpg。
- 原生 H 快捷键和工具状态已检查，但自动拖动被 CUA noWindowsAvailable 阻挡；该手势未完成 UI 自动验收。相机 target 平移由核心测试和实际 Metal 循环覆盖。
- 浏览器自动文件上传被扩展的文件 URL 权限阻挡，未修改用户设置；通过“尺寸示例”入口走真实 ZIP 项目解析流程。
- 20 项 TypeScript 测试、类型检查、Vite 构建及 CTest 通过。真实 SDK 测试覆盖尺寸/原点恢复、拾取与旧空间兼容、仅切换空间不重建网格、目标平移及横竖视口聚焦。
- source_space_test 在 Metal API Validation 下运行 120 帧，覆盖真实尺寸、原点、拾取、正交切换、目标平移和专用视口；validation errors 为 0。最终编辑器重开格式 2 打包解包项目运行 120 帧，错误为 0。

## 已通过

- macOS ARM64 / Apple M4：独立 CMake 工程只链接 `.sdk/native` 安装包，成功生成 `nova_editor.app`。
- 原生 Metal 加载 Damaged Helmet 并绘制 120 帧，开启 `MTL_DEBUG_LAYER=1`，退出结果为 0，validation errors 为 0。
- 实际检查 ImGui 场景树、属性面板与模型同窗显示；点击创建子节点并保存，检查磁盘 project.json 包含正确父子引用与相对资产路径。
- Chrome 实际显示 Nova WebGPU 模型，创建子节点、重命名、撤销/重做并导出项目。
- 浏览器下载事件监听超时，但实际下载文件已生成；随后读取并解压该真实 ZIP，验证其内容，再由原生编辑器打开其中 project.json，自动加载 helmet.glb 并成功绘制 120 帧，validation errors 为 0。
- TypeScript 4 项语义测试通过：共享样例、非法输入、删除/撤销/重做、外部修改隔离。
- C++ CTest 1 项通过：读取相同合法/循环引用样例，并验证删除子树及历史恢复。
- TypeScript 类型检查、Vite 生产构建与 SDK SHA-256 完整性校验通过。
- 项目传输 CLI 已实际打包桌面项目，并解包网页导出的项目。

## 明确限制

- 仅验证本机 macOS ARM64 与 Chrome；未验证 Windows、Linux、其他浏览器或正式安装包签名。
- 原生预览使用整窗背景，尚无独立中央视口。多节点目前为文档能力；独立实例渲染、变换驱动画面、拾取与 gizmo 未实现。
- 网页通过示例项目测试实际渲染及归档打开；浏览器自动上传接口因扩展未启用本地文件权限而失败，未更改用户扩展权限。普通文件选择与拖入 GLB 的交互尚未完成独立验收。
- SDK 来自含未提交修改的本地 Nova 工作区；锁文件证明暂存产物完整性，不证明干净源码可复现性。正式 npm/原生二进制发布和远程获取仍待建设。
- 桌面关闭未保存提醒、中文字体、原生文件对话框、快捷键上下文和拖动操作事务合并尚未完成。

实际网页截图：`output/web-editor.jpg`。本地运行与导入产物放在忽略提交的 `output/` 下。

## 多实例阶段 — 2026-11-14

- Nova 新增 SetScene，Metal / Vulkan / DX12 / WebGPU 增加实例结构化缓冲与按资产分组的硬件实例绘制。模型网格与材质图集按资产共享，TRS 编辑不重建纹理。
- TypeScript 6 项测试通过，新增旋转、非等比/镜像缩放与父子世界矩阵验证；C++ 使用相同 transforms.json 验证父子变换，并保留保存覆盖和历史回归。
- Apple M4 Metal 和 MoltenVK：实际运行 120 帧动态实例测试，覆盖移动、旋转、非等比缩放、增加/删除实例、缓冲扩容、清空/重建场景与旧 LoadModel 接口切换。两后端最终 validation errors 均为 0。Vulkan 首轮发现遗漏描述符更新，修正后完整重跑通过。
- Chrome WebGPU：实际同时显示两顶头盔与牛油果；只修改右侧头盔的位置 X=2.2、旋转 Y=65°、缩放 Y=0.6，其他实例保持不变。检查控制台未见 GPU 错误；复制后增至 4 个实例，撤销恢复 3 个。
- 网页实际导出 ZIP，解压检查独立 TRS 与资产引用后，由桌面原生编辑器成功打开并显示三个模型。
- 实际截图位于 output/web-instances-before.jpg、output/web-instances-after.jpg 和 output/native-instances.jpg。
- 当前尚未在 Windows/DX12 真机运行，也未验证动画实例。初版记录中的“仅单模型预览 / 变换不驱动画面”限制已解除；拾取、gizmo、独立原生视口等限制仍然存在。

## 视口拾取 / Gizmo 阶段 — 2026-11-14～15

- SDK 两端增加精确 CPU 三角形拾取，宽阶段仅用于排除包围盒未命中，最终返回最近实际三角形的实例 ID、世界位置和距离。新增测试用原创单三角形 GLB，不依赖第三方模型的偶然形状。
- Metal 和 Vulkan 实机均通过 `picking_test`：重叠取最近实例、包围盒内空白不命中、镜像/非等比缩放、奇异矩阵与空场景。GPU 校验未报错。
- TypeScript 12 项测试通过；C++ 场景契约测试加入三个移动轴、旋转环、父节点非等比变换、缩放和一次拖拽一个撤销事务。取消恢复原文档且不清除已有 redo；无变化拖拽不产生历史。
- Chrome 实际鼠标操作通过：点击模型选中，X 轴拖动后位置改变；一次 Undo 恢复原位置；Y 旋转环拖动约 89°；局部 Y 缩放手柄改变该分量；Undo/Redo 分别恢复/重做该次缩放；点击另一模型切换，点击空白清除选择。控制台未见 GPU 错误。
- 原生当前构建在独立测试应用中实际点选模型，显示对应树选区、Inspector、包围框与三轴移动工具。随后原生自动拖拽被计算机控制服务的 `noWindowsAvailable` 错误阻断，未将原生物理拖拽记为已验收。原生拖拽数学/事务、GPU 拾取与构建测试均通过。
- 截图：output/gizmo-move.jpg、output/gizmo-rotate.jpg、output/gizmo-scale.jpg、output/web-gizmo-final.jpg、output/native-gizmo-final.jpg。它们是实际运行截图，不是设计稿。
- 仍未完成 Windows 真机验收。GPU/BVH 拾取加速、独立原生视口、像素级选择轮廓、动画实例仍为后续工作；基础点选与三类 gizmo 已实现。

## 浅色界面 — 2026-11-15

- 网页实际载入三实例示例并选中头盔，检查浅色工具栏、场景树、XYZ 属性输入、资源卡片和 gizmo 显示，截图 `output/ui-light-web.jpg`。
- 原生实际运行并检查浅色主题、系统字体及资源区，截图 `output/ui-light-native.jpg`。原生自动点击受窗口工具限制，本轮未完成属性面板的交互复验。
- 新 SDK configureUI 生命周期通过 Metal API Validation 120 帧，validation errors 为 0。
- TypeScript 类型检查、Vite 生产构建、12 项 TypeScript 回归测试与 CTest 场景契约测试通过。仅验证本机 macOS 与 Chrome。

## 白色视口、网格与视图立方体 — 2026-11-15

- 两端默认白色背景，渲染器加载编辑器专用 GLB 地面网格及 XYZ 坐标轴；辅助几何体参与深度测试，不修改文档或导出资产。资源生成脚本与 GLB 同库保存。
- 网页实际验证顶视角、底视角、恢复默认朝向、模型鼠标点选与点击网格取消选择；立方体随相机旋转，角度切换保留距离。截图 `output/viewport-grid-web.jpg`。
- 原生实际检查白色背景、网格、坐标轴、方向指示和立方体显示，截图 `output/viewport-grid-native.jpg`。原生自动点击未能稳定触发，按钮交互未完成 UI 自动验收；相机 API 顶底角度已由 Metal 回归覆盖。
- Native SDK / Web SDK 相机俯仰校验放宽至 ±89.9°，并重新编译安装、刷新本地 SDK 锁定哈希；普通自由环绕仍限制 ±85°。顶底方向使用透视投影，不包含正交模式。
- 14 项 TypeScript 测试、类型检查、Vite 构建、CTest 通过。新测试用真实 Web SDK 加载四个辅助 GLB 并检查归一化还原尺寸，覆盖六方向相机及拾取投影的数值稳定性。
- 最终桌面编辑器含模型与辅助几何体运行 120 帧；原生多实例回归包含 ±89.9° 视角并运行 120 帧，Metal validation errors 均为 0。仅本机 macOS / Chrome 验证，未运行 Windows/Linux。

## 正交视图与 D 主题 — 2026-11-15

- 桌面与网页默认采用用户选定的 D 中性黑白主题。两轮配色研究截图保存在 output/palette-*.jpg，未将其他配色设为产品默认项。
- SDK 的 OrbitCamera 新增 orthographic（默认 false）；栅格投影支持正交，显式 yaw 基底保证精确 ±90° 顶底视图稳定。该公共结构变更影响 ABI，已重新编译安装并刷新锁定哈希，不能混用旧头文件与新二进制。
- 网页实际验证：立方体进入正交顶视角、鼠标点选模型、X gizmo 拖动、一次撤销恢复、投影按钮切换与 P 快捷键。截图 output/orthographic-web.jpg。
- 桌面实际验证：D 主题、P 切换至正交、立方体顶视角；原生窗口先激活后点击成功，截图 output/orthographic-native.jpg。本轮已补齐此前立方体点击未验收项。
- 17 项 TypeScript 测试和 CTest 通过：新测试覆盖六个精确方向下两种投影与真实 SDK 矩阵一致、拾取射线回投、正交深度不改变显示比例、缩放和移动/旋转/缩放 gizmo。原生契约补充精确顶底正交射线回投。
- 原生多实例回归交替透视 / 正交，使用精确 ±90° 顶底视图，Metal API Validation 运行 120 帧，validation errors 为 0。类型检查、Vite 构建和 SDK 哈希验证通过。仅本机 macOS / Chrome 实机验收。


## 场景树升级与保存可靠性 — 2026-11-15

- 原生 ImGui 与网页 React 接入对等的层级命令：搜索/折叠、多选、分组/解组、子树复制和批量删除、拖动改父级/排序/根级落点、隐藏与锁定；每条命令一个撤销记录。重命名在提交时形成一次历史。多选的 gizmo/检查器仍作用于活动节点，群体变换通过分组完成。
- 新增共享 20 节点、三层层级样例 `tests/fixtures/hierarchy.scene.json`。TypeScript 与 C++ 均验证世界矩阵保持、镜像缩放、父子选择去重、排序、锁定继承、分组解组、批量复制/删除与撤销。循环、奇异父级和剪切安全拒绝。节点隐藏/锁定及数组顺序通过项目包往返保存。
- 桌面增加包含资源的本机恢复副本、启动恢复入口、未保存关闭/打开保护及 Save/Discard/Cancel。恢复目录可通过 `--recovery-dir` 隔离。`editor_workflow_test` 直接调用真实 Editor 流程，验证自动保存→新编辑器发现→恢复→保存、保存后打开原/目标路径、保存后关闭，以及资源缺失导致保存失败时保持 dirty、保留基线并阻止关闭。
- 网页使用 IndexedDB 按会话存储完整恢复副本；写入/删除串行，防止旧写入复活已丢弃副本。文件写入成功后更新保存基线；普通 ZIP 下载因无法确认落盘而保留 dirty 与恢复数据。恢复副本不等于正式保存。
- Chrome WebGPU 实际操作验证：尺寸样例、多选两模型分组、折叠/展开、锁定后的属性和 gizmo 禁用、隐藏分组后的零可见模型状态、恢复完整场景与模型资源；名称输入整段提交后，一次撤销恢复旧名称，重做恢复新名称。开发热重载造成页面重建后，通过恢复入口成功找回未保存分组和显示状态。
- 桌面实际启动 Metal 编辑器，载入尺寸模型、显示新树工具与 Inspector，实际点选显示模型选择框；此前一次正常运行关闭输出 validation errors: 0。后续鼠标操作不稳定，界面工具最终报告 Mac 已锁屏，故没有将完整桌面拖拽/关闭弹窗物理操作，以及浏览器文件保存对话框落盘记为已验收。对应原生命令、保存和关闭状态机由自动化测试覆盖；Windows/Linux 未实机验收。
- 41 项 TypeScript 测试、4 项 CTest、TypeScript 类型检查与 Vite 生产构建通过。最终将 TypeScript 命令生成的分组、隐藏和锁定项目交给桌面端，在 Metal API Validation 下实际运行 120 帧，validation errors 为 0。SDK 完整性校验 212 项通过；此阶段不修改或重新暂存 nova-v2 SDK，保持现有依赖锁定。
- 恢复存在约 0.8–1 秒防抖窗口，未提交拖动预览不写入恢复。文件替换防止写入半份 JSON，不承诺断电级持久性或跨文件系统事务。


## three.js Editor 式布局重组 — 2026-11-15

- 两端采用紧凑顶部菜单、左侧大视口、右侧 Scene / Project / Settings 侧栏。场景树位于属性上方，支持调整分界高度。资源库默认收起且只占视口列，开合不压缩右侧属性；变换工具移到视口底部。仍使用 Nova SDK 与原有 D 主题、灰色背景，不添加无功能的播放或材质入口。
- 文件/编辑/添加/视图菜单均连接实际操作。网页菜单支持键盘上下导航和 Escape/失焦关闭；桌面打开/导入菜单将焦点引导到 Project 页对应路径输入。新建项目保留未保存保护，新增原生保存后新建及不复用原路径的流程回归。
- Chrome WebGPU 实际检查：菜单加载尺寸样例、三个侧栏页切换、设置和视口网格步长同步、光照入口切回场景属性、资源抽屉开合及开合后的模型点选。读取实际 DOM 几何验证 canvas 与交互 SVG 的位置/尺寸完全一致，视口与抽屉均未越过右侧栏边界；控制台无 error/warn。最终截图 `output/layout-three-editor-web.jpg`。
- 新增 `editor_layout_render_test`，直接绘制真实 Editor UI，在 1440×900 与 GLFW 缩放后的 900×640 窗口中依次覆盖 Scene/Project/Settings、光照属性和资源抽屉开/关；Metal API Validation 实际完成 180 帧，validation errors: 0。此测试验证 UI 分支与视口渲染，不代替原生全部物理鼠标操作验收。
- 41 项 TypeScript 测试、4 项 CTest、双端构建通过。未更改 Nova SDK 及依赖锁。

运行原生布局检查：

```sh
MTL_DEBUG_LAYER=1 ./build/editor_layout_render_test resources/viewport tests/fixtures/triangle.glb
```


## 精简视口控件 — 2026-11-15

- 两端移除立方体下方的方向快捷按钮、默认朝向按钮和投影文字入口；网页移除左上角聚焦/全景按钮。立方体面点击、顶部投影切换、视图菜单和 F / Shift+F / Home / P 快捷键保留。
- 原生同步缩小立方体鼠标拦截区域，移除按钮后的空白区域可正常操作视口。
- 网页实际载入尺寸样例并点击立方体顶面，确认进入正交顶视图；截图 `output/viewport-clean-controls.jpg`。双端构建通过。

- 继续精简：两端移除视口底部的移动/旋转/缩放/平移工具条及快捷键文案，保留 W/E/R/H 输入处理与 gizmo。

## 参数几何体与材质 — 2026-11-15

- 六种形状：box、plane、sphere、cylinder、cone、torus。TypeScript 生成结果由真实 Web SDK 加载；C++ 使用同组夹具验证三角形数、尺寸、绕序、法线和 UV。覆盖非法参数与损坏 GLB 拒绝、PBR 修改、贴图内嵌/移除、重建保留贴图和项目包往返。
- 真实 Editor 工作流测试覆盖创建、复制共享、独立副本、几何/材质修改、撤销重做、另存为及历史资源可用性。45 项 TypeScript 测试、5 项 CTest、双端构建通过；SDK 212 文件完整性通过，依赖未更新。
- Metal API Validation 实际完成 360 帧：六种几何体、PBR/内嵌贴图、参数重建、几何/材质页及窗口缩放，validation errors: 0。此项不代替桌面全部物理鼠标操作验收。
- Chrome 实测创建与参数应用、PBR 色彩修改、复制共享和独立副本；热重载后的恢复入口找回参数与材质。内嵌棋盘平面宽度 3→4 后贴图保留，单次撤销返回 3 且项目恢复已保存状态。六模型场景实际渲染并检查截图 `output/geometry-materials-web.jpg`，控制台无 error/warn。
- 浏览器自动文件选择受扩展 file URL 权限限制，此轮未完成文件选择器上传验收；以真实内嵌 PNG 覆盖 SDK 渲染、参数重建与保存。未修改浏览器权限。仅本机 macOS/Chrome 验证，Windows/Linux 未实测。

## 模型内部节点、子网格与独立材质槽 — 2026-11-15

- 新增可重建的 `tests/fixtures/model-parts.glb`：四个原始 GLB 节点，Body 含两个材质不同的 primitive，Top/Base 重复引用带内嵌棋盘贴图的网格。两端展开为九个编辑器节点、三个子网格资源和四个渲染实例。
- TypeScript/C++ 对同一夹具验证原始单位、父子变换、镜像矩阵、旧归一化模型、资源共享、槽间 PBR/贴图隔离、单步展开撤销与重做，以及动画、循环、零缩放、剪切、透明材质、缓冲越界等拒绝。Web SDK 实际加载两个不同 PBR 槽；贴图由浏览器与原生渲染验收。子资源重映射 accessor/bufferView/texture/image，仅保留使用的数据。
- 原生真实 Editor 工作流覆盖 GLB 导入、展开的单次撤销、独立槽修改、子网格变换、保存和新 Editor 重开，以及旧项目模型展开后撤销恢复原资产。48 项 TypeScript 测试、6 项 CTest、类型检查与双端构建通过。
- 最终 Metal API Validation 完成 360 帧，实际绘制编辑器 UI、模型槽列表与材质页、六种几何体、不同 PBR 材质和棋盘贴图。真实射线分别命中左右子网格的不同节点 ID；修改一个槽后继续渲染，validation errors: 0。没有把原生全部物理鼠标操作计作已验证。
- Chrome 从“模型结构示例”走真实 importGLB 流程，加载多材质 GLB；绿色槽修改为 #51b66a、粗糙度 0.2 后蓝色槽仍为 #3881c4、0.25。Top/Base 原共享资产，经 Make unique 修改 Top 色彩，Base 棋盘仍保持白色；Top 子网格 Y=0.35 独立移动。
- Chrome 视口实际点击绿色子网格并选中对应树行，拖动 X gizmo 将局部 X 从 0 改为约 0.503，单次撤销返回 0。刷新页面，通过本机恢复找回九节点层级、四个资源、独立材质和贴图；颜色 #51b66a 与粗糙度 0.2 保留。最终截图 `output/model-nodes-material-slots-web.jpg`，控制台无 error/warn。
- SDK 212 文件哈希验证通过，未更新或修改依赖。本轮仅本机 macOS Metal / Chrome WebGPU；Windows/Linux 未实机验证。静态三角形子网格的层级/变换/材质编辑已实现，顶点/拓扑编辑、跨网格共享材质库和原始单 GLB 重组导出尚未实现。

## 多选整体变换与局部/世界坐标 — 2026-11-15

- 新增双端共享 `selection-transforms.json`：共同中心、世界/局部移动、绕中心旋转、世界轴与活动节点局部轴缩放、等比放大后间距变化，逐项对照完整世界矩阵。TypeScript/C++ 均覆盖透视/正交射线 gizmo、父子选择去重、冻结预览不累积、单次撤销/重做、取消与空操作保留 redo，以及锁定、隐藏、奇异父级、零缩放、剪切的整次拒绝。
- TypeScript 额外覆盖不同旋转和非等比父级下的世界平移、整体等比缩放、后代继承和项目归档往返；两端数值坐标测试在旋转/缩放父级下设置世界位置并验证局部结果。原生真实 Editor 工作流增加多选整体 TRS、单次撤销/重做、另存为与新 Editor 重开保持完整文档。
- 53 项 TypeScript 测试、7 项 CTest、TypeScript 类型检查、Web 生产构建和原生构建通过。SDK 212 文件完整性通过，依赖未修改或更新。
- 最终 `editor_layout_render_test` 在 Metal API Validation 下完成 480 帧，实际绘制多选整体数值页、世界/局部移动旋转缩放 gizmo、选择框、正交视图和单选世界数值页；提交整体 TRS 后执行 undo/redo，validation errors: 0。原生完整物理鼠标交互未计为已验收。
- Chrome 实测 Box/Sphere 多选世界 X gizmo：两者 X 均增加约 1.747958，一次撤销分别恢复 -4、0。右侧一次应用 Y=30° 与等比 1.3 后，Sphere 世界位置为约 (0.251666, 1, -1.3)，旋转 Y=30°、scale=(1.3,1.3,1.3)。X 键切换世界/局部后实际 SVG 轴方向不同。
- Chrome 实际旋转环拖动将共同 Y 角从 30° 改为约 75.005°，一次撤销返回 30°；中心缩放方块将两对象缩放从 1.3 改为约 1.559967，一次撤销返回 1.3。视口 Meta 点选成功增加第二模型；正交模式整体移动后可撤销。F 聚焦全部选中模型。
- 刷新浏览器，通过本机恢复找回整体变换后的所有模型；Sphere 位置、Y 角与三轴缩放均保持。控制台无 error/warn，截图 `output/selection-transform-web.jpg`。仅本机 macOS Metal / Chrome WebGPU 实测，Windows/Linux 未实机验证。TRS 无法表示的剪切仍明确拒绝，不宣称任意仿射编辑。

## 场景灯光、相机与项目持久化 — 2026-11-16

- 新增共享 `scene-objects.json`：两个相机（透视/正交）、两个方向光。TS/C++ 对照真实 SDK 的 OrbitCamera 约束，验证世界位置/方向、曝光、正交高度反算、精确顶底极点、捕获编辑视角、主相机切换、光照线性颜色/方向与阴影参数。活动光随父节点旋转，隐藏后直射强度为零且阴影关闭。
- schema v3 双端校验覆盖互斥组件、参数范围、唯一主相机/活动光；旧 v1/v2 继续读取，未来非法格式改为 v4 夹具。组件复制清除主/活动标记，删除、undo/redo、归档与本机恢复保持一致。真实原生 Editor 流程覆盖新建相机、复制并切主相机、方向光参数、添加几何体保留 v3、自动保存恢复、另存为与新 Editor 重开。
- 58 项 TypeScript 测试、8 项 CTest、类型检查、Web 生产构建和原生构建通过；SDK 212 文件哈希通过，未更新或修改 Nova 依赖。
- 最终 Metal API Validation `editor_layout_render_test` 完成 720 帧，实际绘制节点属性、相机/光辅助体、原有多选编辑及材质。验证 SetDirectionalLight 强度 6、透视主相机 yaw 25°、切换正交主相机、编辑相机方向、返回原编辑视角、捕获、删除/撤销及产生滚转时退出预览；validation errors: 0。未计为原生全部物理鼠标操作验收。
- Chrome 加载“灯光与相机示例”，透视主相机预览切换至正交 Camera side；修改视野高度为 9、曝光 1.4 并返回编辑视角。实际新增相机与方向光，颜色 #ffb86b、强度 5、阴影柔和度 3、方位 -50°；阴影开关在真实画面中生效。方向光通过视口图标点选正确。新增相机不抢占主相机，捕获编辑视角可用。
- 实际键盘输入发现位置框逐字符提交造成焦点丢失，修正为 Enter/失焦一次提交后，成功将方向光 X 设为 -4.5。刷新和恢复后，相机、活动光、阴影和变换均保留。保存/导出提示不会再被异步“就绪”覆盖。
- 网页系统文件选择器路径未在本次自动操作中确认完成；新增“下载项目包”直接取得真实 Chrome 下载 ZIP。下载事件监听未返回路径，通过已知下载文件实际读取确认 v3 / 12 节点 / 6 GLB、Camera side 为唯一主相机、正交高度 9 / 曝光 1.4、活动方向光强度 5 / softness 3 / shadows=true / X=-4.5。文件副本与解包结果位于 `output/browser-scene-objects-save/`。
- 直接使用网页真实导出包的解包项目启动桌面端，Metal API Validation 实际完成 120 帧，validation errors: 0。证明新组件文档可跨端读取，不将“已发起下载”伪标为已保存；网页恢复副本继续保留。
- Chrome 控制台无 error/warn；截图 `output/scene-objects-web.jpg`、`output/main-camera-web.jpg`。仅本机 macOS / Chrome 验证，Windows/Linux 未实测。当前同时使用单方向光，FOV 45° 与裁剪 0.01–200 固定；点光/聚光、多光叠加、滚转及可调 FOV/裁剪面未实现。相机视锥为辅助示意。

## 2026-11-16 环境贴图、背景与雾效

- schema v4 WorldSettings 在双端统一校验路径、数值、六位颜色、雾区间与贴图依赖；环境资源作为项目依赖保存，无需伪装为 GLB。ZIP、恢复副本、CLI pack/unpack 与原生 SaveAs 包含 `.nenv`。另存为后撤销移除贴图仍可用。
- 原生/Web 使用真实 SDK 栅格着色器雾，支持关闭、线性与 exp²，按视空间深度混合。补丁从隔离副本编译，原生 Metal/Vulkan 着色器及 Web WGSL 成功；路径追踪布局保持旧值，编辑器不使用路径追踪雾。隔离补丁复现输出逐字节一致。
- 61 项 TypeScript 测试、9 项 CTest、双端构建及 220 项 SDK 文件校验通过。新增测试包含真实 NOVENV02 资源/非法浮点/截断拒绝、颜色转换、雾深度公式、v4 参数、ZIP 与恢复、历史资源复制。Metal GPU 测试 90 帧切换线性/exp²、环境旋转、正交相机和移除环境，validation errors 为 0。
- Chrome WebGPU 实际打开几何体示例，导入日落预设、旋转45°、强度1.5、背景亮度0.8；验证纯色/贴图背景、线性雾与 exp² 密度0.035、移除贴图并撤销。截图 `output/world-fog-web.jpg`、`output/world-environment-web.jpg`；控制台无 warning/error。
- 重新加载页面后，通过本次恢复副本确认贴图与所有参数恢复。实际“下载项目包”所得 ZIP 含6个模型及约20MiB环境资源，解包到 `output/world-web-export/`，桌面打开并运行120帧，validation errors 为0；CLI再次pack/unpack也保留贴图。
- 本次实机验证 macOS Metal 与 Chrome WebGPU；Windows/Linux未实机验证。环境文件选择器未通过浏览器自动上传验证；预设通过真实相同字节导入路径验证。HDR/EXR直接导入不支持，使用Nova离线烘焙 `.nenv`。SDK基于 f016292 dirty 快照，后续上游提交未混入，见 SDK-ATMOSPHERE.md。
- 最终额外启用 `MTL_DEBUG_LAYER=1`：环境回归90帧与原有多实例120帧（TRS、增删/清空、模型接口切换、正交与极点相机）均通过，Metal API Validation错误为0。CLI环境资源再次往返的内容逐字节一致。

## 2026-11-16 Release 下载、版本锁定与更新

- 实际从 GitHub Release v0.2.0 下载 manifest、macOS ARM64 Release SDK 与 Web tgz；校验 Release 附件摘要、配对清单、包内版本/干净提交和 shader 摘要。新锁格式3记录 Release/附件 ID、URL、SHA-256、源码9c133a2、203项安装文件；不再将编辑器 JSON 头文件混入 SDK 锁。
- `sdk:install` 无参数严格恢复锁；`sdk:update <精确版本>` 显式升级，`--check` 不写文件。真实检查当前与最新兼容版本均为0.2.0，检查前后锁文件哈希不变。兼容策略为稳定0.2.x，无 latest 自动升级。
- 实际完成默认恢复、`sdk:install --offline`、仅含锁与缓存的全新目录离线恢复；锁文件逐字节不变，恢复目录不需要 `.sdk/support`。编辑器 nlohmann/json 3.12.0 与 MIT 许可已随仓库保存，原生构建使用该副本。
- 真实网络遇到 Node 超时、附件断流和公共 API 请求拒绝，失败未替换已安装 SDK；已增加同一官方地址的 curl 断点续传、完整哈希验证，以及已有 gh 会话/CI token 的元数据认证。最终官方包下载与事务安装成功。未校验的 partial 不用于离线安装。
- 11项依赖管理测试覆盖真实压缩包解包/安装、模拟0.2.0→0.2.1同步更新、旧锁迁移、缓存损坏、离线缺失、不同源码/模块/版本拒绝、路径与符号链接拒绝、并发保护、中途失败/首次失败回滚、进程中断恢复、CLI全新目录恢复和断流续传。与58项原有业务测试合计69项通过；8项CTest、网页生产构建和原生Release构建通过。
- CMake配置使用版本/提交配对检查，实际以伪造的0.2.99原生元数据确认配置在链接前拒绝混用；网页启动/构建使用完整203项哈希检查。构建不应与安装并行。
- 本次未修改渲染算法或UI；下载的0.2.0二进制与此前已验证的配对包内容一致。当前上游Release原生只提供macOS ARM64，未声称支持不存在的Windows/Linux 0.2附件。

## 2026-11-16 相机 FOV、裁剪与滚转

- 双端相机属性接入垂直FOV、近/远裁剪、局部roll；正式SDK保持0.2.0/9c133a2、203项校验，不修改渲染依赖。新镜头字段一起保存为schema v5；滚转沿用节点四元数。旧v1–v4保持45°与0.01–200默认值，其他编辑/环境命令不降级v5。
- 投影、射线、gizmo屏幕尺寸、平移、视图立方体和SDK桥接使用相同镜头/姿态；正交高度独立于FOV。共享fixture覆盖非等比缩放父级、组合旋转、roll与精确极点。捕获镜头分别逆变换位置/朝向，不再因为相机父缩放错误地产生剪切。
- 72项共享/依赖管理测试、9项CTest及双端构建通过。90帧Metal镜头回归切换FOV30/95、近裁剪0.2/20、远裁剪1000、roll -45至44、透视/正交，读回及API Validation通过；720帧真实编辑器回归含滚转主相机、切主相机和返回编辑视角，校验错误0。
- Chrome真实操作灯光相机示例：主相机FOV70、near0.5/far80、roll20，预览可见画面旋转；far4和near12分别实际裁切模型，恢复0.5/80后画面恢复；正交高度12与透视切换均保留roll与裁剪。截图`output/camera-lens-web.jpg`。
- 实际下载`nova-project (4).zip`确认schema5与完整镜头参数，解包到`output/camera-web-export`，桌面打开120帧且验证错误0。浏览器刷新后恢复本次副本，界面读回FOV70、near0.5、far80、roll20。桌面窗口图像正常；原生鼠标自动化未能注入点击（noWindowsAvailable），不把该点击计为成功，桌面回调与预览由上述合同/工作流/GPU回归验证。
- 已说明桌面SDK隐藏路径`.sdk/native`（当前约36MiB），头文件/include、静态库/lib、CMake配置/lib/cmake/Nova；Finder可用Cmd+Shift+.显示。Windows/Linux原生未实机验证；本次实机范围为macOS Metal与Chrome WebGPU。

## 2026-11-16 可见依赖目录迁移

- 正式依赖迁至 `deps/nova/native/`、`deps/nova/web/` 和 `deps/nova/package/`，锁格式 v4 记录规范路径；版本仍为 0.2.0、源码仍为 9c133a2，附件哈希与 203 项正式文件内容不变。下载缓存和事务迁至 `.cache/nova/`。本机旧 `.sdk/` 整体保存在 `.cache/nova/legacy-sdk-backup/`，活动路径不再依赖它。
- 实际完成旧缓存离线迁移、移走旧目录后的离线与默认锁定恢复。网页部署副本从正式 Web 包同步，缺失/损坏时原子修复；损坏正式依赖拒绝同步。14项依赖测试包含旧日志恢复、旧锁/缓存迁移和部署副本重建，与业务测试合计75项通过；9项CTest通过。
- 现有 CMake 缓存自动迁到新目录；新建 `build-deps-check/` 从默认路径配置并完成 Release 构建。Metal API Validation 下打开含镜头参数的项目，实际渲染120帧，validation errors 为0。
- 网页生产构建通过，Chrome打开独立生产预览端口5234，实际加载灯光与相机示例：6个模型、10个节点，WebGPU画面正常，控制台无warning/error。截图 `output/deps-nova-web.jpg`。实机验证范围为macOS ARM64 Metal与Chrome WebGPU。

## 2026-11-17：正式 0.3.0 多灯接入

- 从 GitHub Release 下载安装 0.3.0，同一干净源提交 `087562d8b1cf652c821746b2d5c33d8f6db59f85`；保留 SDK 安装清单，未改包内源码或着色器。
- 77 项 JS 测试、10 项原生 CTest，覆盖六灯独立启用、父子变换、未缩放范围、聚光局部 -Z、锥体辅助线、错误输入、历史、归档、保存和恢复。
- Chrome WebGPU 实际创建方向光、点光、聚光，逐灯开关改变画面，点光/聚光阴影选项禁用，编辑后撤销与 ZIP 保存重开通过。截图 `output/lights-browser/editor.png`。
- Metal 原生构建成功，并打开网页保存的同一三灯项目，在验证层开启时完成 120 帧原生 UI 集成测试（点光开关、撤销、聚光锥角修改），GPU 错误为 0；渲染实现的六灯逐盏/同时贡献由 nova-render 共享 HLSL 像素测试验证。
- 场景 v6 允许最多 16 盏独立灯；旧格式原 inactive 灯保持关闭。点光/聚光阴影明确不支持；Vulkan/DX12/光追仍使用旧单方向光，编辑器本轮面向 Metal/WebGPU 光栅。

## 2026-11-17：0.4.0 跨后端灯光

- 已从正式 GitHub Release 更新并锁定 0.4.0（干净源提交 `e3503a02808531c0e43ec60e24b9aae5b607dfc8`），205 个安装文件校验通过；未修改包内源码或 shader。
- 77 项 JS 测试、10 项原生 CTest 全部通过。SDK 安装器兼容策略显式升级为稳定 0.4.x。
- `lights_render_test <project.json> <viewport-resources> vulkan|metal` 分别完成 120 帧实际 UI 集成，验证同时三种灯、点光独立开关/撤销、聚光锥角修改，GPU 错误为 0。
- 实际编辑器 `--api vulkan --project ... --frames 12` 正常渲染，验证错误 0；默认 `--api auto` 保留原后端优先级。CLI 也接受 metal/dx12，但仍受当前平台是否支持该 API 的限制。
- Chrome WebGPU 灯光创建、开关引起的像素变化、阴影选项禁用、撤销和 ZIP 保存重开通过。
- 上游共享 HLSL 的 DX12 顶点/片元已编译为 DXIL；用户明确将 Windows 验证延期，因此未进行 DX12/Windows Vulkan 实机验证，也未发布 0.4.0 Windows SDK。点光/聚光阴影与光追模式灯光集合仍不支持，能力查询和界面明确报告。

## 2026-11-17：0.5.0 点光与聚光阴影

- 从正式 GitHub Release 安装并锁定 Nova 0.5.0，干净源提交 `2199a85b715d243aa0190553f7a40c428f1dfdd7`；205 个 SDK 文件校验通过，未修改包内源码或 shader。
- 78 项 JS 测试与 10 项原生 CTest 全部通过。新增共用 `light-shadows.json` 场景 v7 夹具，覆盖阴影标志、保存/恢复、归档、撤销及不降级版本。旧 v1–v6 保留原值；首次启用点光/聚光阴影才升级 v7。
- Metal（验证层开启）和 Mac Vulkan 各完成 120 帧实际原生 UI 集成，三种灯的 `castShadow` 正确桥接，GPU 错误为 0。
- Chrome 实际创建三类灯、打开阴影；逐个关闭点光和聚光阴影均产生像素差异，撤销后标志恢复。ZIP 导出为 v7，重开后阴影勾选和锥角保留。
- 上游 Metal/Vulkan/WebGPU 图像检查覆盖软硬阴影、全局/逐物体开关、遮挡物移动、光源背后物体不误投影、范围/锥角排除和混合灯逐灯阴影开关。点光/聚光使用有限 BVH 射线和世界空间光源圆盘；仅支持静态不透明实例。
- DX12 shader 已编译为 DXIL，Windows 实机验证按用户要求延期；0.5.0 不含 Windows SDK。

## 2026-11-17：双端 GLB 场景导出

- 桌面 File 与网页文件菜单接入选中子树/完整场景导出。必要祖先以空节点保留，局部 TRS 不烘焙丢失；父子重叠多选去重。共享资产复用 mesh/material/texture，实例复制节点图；重新映射 accessor、bufferView、材质槽、贴图、图片、sampler，合并 BIN。旧归一化模型额外保留归一化节点。
- 新增 TS/C++ 导出器与同一输入/预期 GLB 夹具，逐项比较 JSON 和 BIN。覆盖非等比/镜像父变换、多实例、多材质、两份资源的贴图索引、内嵌 PNG 字节、子树与祖先、空场景、旧归一化，以及拒绝缺资源/动画/未知扩展。额外 TS 测试覆盖相机、聚光和 required 材质扩展。既有78项共享测试加3项导出测试；11项CTest通过（包含跨端导出对照）。
- 网页类型检查与59模块生产构建通过。Chrome真实打开模型结构示例，文件菜单包含两个导出入口，下载得到 `Downloads/scene.glb`；读回13节点、3网格、3材质、1图片，复制到 `output/glb-browser-export/`。浏览器 download 事件的自动化等待超时，后续调试连接无法重新附着；不把选中对象菜单点击或页面截图计为已验收。选中范围与双端数据一致性由上述合同测试验证。
- 已验证导出文件能由正式Nova SDK重新加载：48个三角形，层级/材质/贴图仍包含在单GLB中。原生GPU最终结果见后续追加。Windows/Linux没有本次实机测试。
- 原生/Web均拒绝动画、蒙皮、自定义GLB块、外部图片及不支持的扩展，而非静默丢失。相机及punctual灯写入标准字段；Nova相对光强、隐藏/锁定与阴影extras不保证第三方工具呈现一致。环境贴图/背景/雾及编辑器辅助体不作为模型导出；项目包仍是完整编辑状态格式。未改变SDK版本或文件。
- 最终：网页真实下载GLB由桌面Metal编辑器重新打开并渲染30帧，Metal API Validation错误0；最终原生Release构建、类型检查、11项CTest及205项SDK文件校验通过。

## 2026-11-17：0.8 正式来源与 Alpha 材质往返收尾

- 使用现有本机代理成功从官方 GitHub Release v0.8.0 安装 native/Web 配对包；锁来源从 local-package 切换 github-release，干净提交3fa5679c26fd12b28e078ca522779cce7a2a5dc8，Release ID448544277。正式包与原本地包源码提交不同，未冒称仅改URL；已重新配置/构建、检查221个文件并完成离线重放。
- 更新README与SDK材质/分工说明，明确光栅OIT、MASK/双面、光追、阴影、拾取及AA限制，旧0.7接口核对标为历史。
- 新增网页业务层恢复记录→项目ZIP往返→完整/选中GLB导出重开的测试，逐项比较材质JSON和图片字节。原生使用同一Layer夹具做真实磁盘SaveProject/SaveRecovery/ReadRecovery，再导出完整/选中GLB，与网页参考输出JSON/BIN完全一致；夹具随仓库保存，原生测试不依赖先运行JS。
- 85项共享测试、11项CTest、原生Release构建、网页类型检查与生产构建通过；221项SDK校验通过。桌面保存项目重开Metal渲染30帧，validation errors为0。另对导出GLB执行实际SDK加载/渲染。
- Chrome生产页面可打开；本机浏览器扩展的本地文件权限阻止filechooser上传，未修改安全/访问设置。不把本轮浏览器全流程点击、IndexedDB刷新恢复或截图算作已验证；网页保存/恢复/导出内容由业务层及双端合同测试覆盖。Windows/Linux本轮未实机验证。
- 导出的 `native.glb` 作为新资产重开，Metal实际再渲染30帧，validation errors为0；保留8个三角形的透明/裁剪/双面夹具内容。
