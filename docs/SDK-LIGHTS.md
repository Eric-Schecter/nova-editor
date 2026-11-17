# 点光、聚光与多灯接口需求

状态：2026-11-17，Nova Render 0.7.0 已正式发布，编辑器已接入 Metal / Vulkan / DX12 / WebGPU 光栅的灯光集合。Metal、Mac Vulkan、WebGPU 已验证；DX12 实机按用户要求延期，0.7.0 不包含 Windows SDK。

正式契约见 https://eric-schecter.github.io/nova-render/api/lights 。最多 16 盏灯，三类灯均支持阴影，要求静态不透明场景与全局开关。下文保留需求说明作为验收依据。场景格式 v6 中 `light.active` 表示每灯独立启用；v1–v5 的原非活动灯保持关闭，编辑灯时升级 v6。范围为世界单位，锥角存弧度半角，面板显示度。

## 已核实的基线

锁定包 0.2.0 / 9c133a2 的 `Renderer`、`Window` 只有 `SetDirectionalLight` / `GetDirectionalLight`，Web 对应 `setDirectionalLight` / `getDirectionalLight`。方向为表面指向光源，颜色为线性 RGB，强度范围 [0,100]；阴影由全局 `SceneShadowSettings` 控制。没有点光、聚光、灯光集合或多灯能力查询。相邻 nova-v2 当前工作树公开接口也仍是单方向光；此结论不代表未发布分支的状态。

编辑器当前 light 组件仅 directional，active 互斥；必须迁移为每灯独立启用，不能只增加面板字段或循环调用单灯 setter 冒充多灯。

## nova-render 需提供的最小公开契约

以下名字为建议，最终以双方确认并发布的正式 API 为准；C++ 与 JS 字段、单位、校验和行为必须一致。

1. 灯光数据：`SceneLight`，包含稳定 `id`、`type`（directional/point/spot）、`enabled`、线性 RGB `color`、`intensity`、世界空间 `position`、`direction`、`range`、`innerConeAngle`、`outerConeAngle`、`castShadow` 和 `shadowSoftness`。世界单位沿用模型原始空间。集合中 ID 唯一；只校验当前类型适用字段。
2. 集合接口：`Renderer/Window::SetLights(...)` / `GetLights()`；Web `setLights(lights)` / `getLights()`。一次替换完整集合，空数组清除直接灯光；读取返回独立副本。多方向光、点光、聚光同时累加 PBR 直接光，环境光照独立叠加。关闭/移除灯立即生效，不重新加载模型。
3. 能力查询：支持的灯类型、总灯数/各类型上限、点光/聚光阴影支持情况；按当前设备、后端和渲染模式返回真实结果。最低验收集合为 2 个方向光 + 2 个点光 + 2 个聚光同时生效，上限可高于此，但不能静默截断。
4. 阴影语义：现有全局设置作为总开关和质量设置，逐灯 `castShadow` 控制参与；每灯柔和度与当前尺度兼容。点光/聚光本轮必须真实照明，阴影若未实现要明确返回不支持，编辑器禁用对应选项，不得套用方向光阴影伪装。

## 必须约定的数值与兼容规则

- 方向光保留既有“表面指向光源”的 direction；聚光 direction 为光源向外照射方向（编辑器局部 -Z）。类型语义写入 API 注释，避免方向相反。方向向量需有限且非零，由 SDK 归一化。
- 聚光角度使用弧度，均为半角：`0 <= inner <= outer < pi/2`；内锥全亮、内外锥间平滑衰减、外锥为零。面板显示角度，桥接层负责转换。
- 点光和聚光采用逆平方距离衰减、有限源附近避免奇点；`range=0` 表示不设截断，正数表示该距离外贡献为零并平滑衰减。具体近场钳制值及截断公式由 nova-render 固定并文档化，native/Web 使用相同公式。
- 本轮强度建议延续 [0,100] 的 Nova 相对标量，不冒称流明或坎德拉；颜色为 [0,1] 线性 RGB。若上游选择物理单位，需要同时明确迁移与默认值。
- 非有限数值、负强度/范围、重复 ID、非法角度或超限：整批拒绝并保留旧集合；C++ 异常或明确错误结果，JS 抛错。提供可定位原因，不能静默丢灯或半更新。
- 空集合不得自动补回摄影棚灯。编辑器无场景灯时的默认灯由桥接层显式提交；隐藏节点及隐藏祖先关闭对应灯，不影响其他灯。
- 旧单灯 API 保持可用，但必须定义与集合 API 的互操作。建议单灯 setter 替换集合为一个兼容方向光；调用集合 API 后不另加旧灯。SDK 自带面板也不得每帧覆盖集合。
- 变更灯光应使路径追踪累积失效；未支持多灯的渲染模式须通过能力查询明确报告。本轮编辑器验收目标为原生 Metal 与 WebGPU 栅格。

## nova-editor 接入范围

- 新增点光/聚光节点；颜色、强度、范围、内外锥角、启用状态及受支持的阴影属性编辑。位置/旋转沿用层级、gizmo、局部/世界坐标；父缩放不隐式改变灯强或范围。
- 删除方向光 active 的互斥约束，保留“启用”语义；旧项目原活动灯启用，原非活动灯保持关闭，避免迁移后突然变亮。字段默认值与 schema 迁移、归档、恢复、撤销重做一起实现。
- 收集所有有效灯并一次提交，正确处理隐藏祖先、删除、重新打开和默认摄影棚光。属性预览不能反复上传模型。
- 辅助显示由编辑器负责：点光范围球、聚光锥体与朝向、选中高亮、辅助体点选和 gizmo；无需 nova-render 提供项目树或 GUI API。无限范围以固定图标表示，不画无限球。

## 上游交付与验收

- 同一干净提交构建的 native 头文件/静态库、Web 模块/着色器，正式 Release 配对 manifest 与能力标记。正式发布版本须满足兼容策略；若升到 0.6.x，编辑器明确调整当前 0.2.x 更新策略，不能强行套用旧包。
- 上游测试：灯类型/数量与非法输入、空集合/移除、方向和锥角、距离衰减、单灯兼容、环境叠加、模式能力和阴影限制；灯光集合出错不得破坏已用状态。
- 编辑器双端共用夹具：多灯混色和强度叠加、移动点光、旋转聚光、切内外锥角、隐藏/删除、父子变换、旧项目迁移、撤销、保存重开和跨端归档。真实 GPU 画面须证明每盏灯分别及同时贡献；API 调用成功不等于照明验收。

编辑器使用正式 Release 0.7.0 配对包，SDK 源码与二进制保持安装清单原样；项目与 UI 逻辑留在编辑器。

## 0.6.0 阴影接入

三类灯的对象属性页均提供阴影开关和柔和度。点光/聚光使用有限长度的 BVH 可见性射线，源后物体不会投影。柔和度范围 0–4；本地光源圆盘半径为 `softness * .006` 世界单位，方向光仍使用弧度。

旧 v1–v6 文档保持原阴影状态。首次开启点光/聚光阴影时写入场景 v7（现有字段 `light.shadows`），后续编辑、切换启用、相机操作不降级版本。旧编辑器会拒绝 v7，而不会错误展示无阴影结果。阴影仅支持静态不透明实例；Windows 实机验证仍延期。

## 0.6.0 ray tracing and instance scenes

The native toolbar and web viewport can switch between raster and ray tracing. This is viewport state and does not change the project format. Instances, camera, materials and light collections survive switching. PT defaults to three bounces, half resolution and denoising; raster PBR/Unlit is disabled in ray mode. Earlier baseline sections above describe historical raster requirements.

Metal uses hardware rays; Mac Vulkan and WebGPU use compute BVH. Instance transforms and material changes rebuild a static ray snapshot; light changes reset accumulation without re-uploading geometry. Collection lights contribute through camera-path NEE in PT, BDPT, photon mapping and MLT. They currently do not emit BDPT source subpaths or photons; capabilities report these limits.

Validation: published paired SDK installation and all 205 file hashes passed. All 78 JS tests and 10 native tests passed. Metal and Vulkan each ran 120 native UI frames covering mode switching, light edits and instance movement with zero GPU errors. Browser UI checks covered ray/raster switching, point-light editing and undo, independent material updates, plus existing camera, shadow, fog, environment and ZIP restore regression. Run node tools/check-ray-mode.mjs; ignored output/ contains logs and captures. Windows runtime validation remains deferred and this release has no Windows SDK.

## 0.7.0 local light source transport

The native and web viewport selectors expose PT, BDPT and Photon mapping. Point/spot lights now participate in BDPT source subpaths and photon emission through the published paired SDK; directional lights retain camera-path NEE. Capability flags explicitly list point/spot source support. Integrator selection is viewport state and does not change scene serialization.

Shared HLSL handles delta-position PDFs, sphere/cone emission, source selection normalization, range falloff and direct/indirect separation. Photon density reconstruction retains finite-budget bias, especially for sharp glass caustics; it is not pixel-identical to PT. Editor validation covers selecting each integrator, light edits/undo, instance movement and runtime material changes on Metal, Vulkan compute BVH and WebGPU. Windows runtime remains deferred.
