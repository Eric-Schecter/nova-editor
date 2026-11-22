# 透明、Alpha 裁剪和双面：SDK 接口确认

状态：2026-11-17，已接入正式 GitHub Release 0.8.0 配对包，具体提交和附件摘要以 nova-sdk.lock.json 为准。双端面板与 glTF 材质字段已接通。

光栅支持 weighted-blended OIT、MASK、逐材质双面及 MASK 阴影。BLEND 阴影、Alpha 感知拾取、MASK/BLEND 光追及光追逐材质单双面尚不支持；BLEND 的 MSAA/TAA/AASplit 也不支持，以 SDK 能力查询为准。切换渲染模式不能视为这些能力已具备。

以下 0.7.1 核对及接口提案保留为历史验收依据，不代表当前缺口。

## 核对结果

- C++ `render::Material` 有 `baseColor[4]`，注释限定 opaque；没有 alpha mode、cutoff 或 double-sided 字段。现有 `GetMaterials/SetMaterial` 可作为扩展入口，无需另建一套材质管理。
- Web `validateMaterial` 同样缺这三个字段。`ModelData.js` 与原生 `ModelData.cpp` 明确拒绝非 OPAQUE glTF。RGBA 的第四通道不能证明透明混合已实现。
- 原生与 Web 光栅部分路径目前关闭背面剔除，不等于支持逐材质单双面：还需要正确的背面法线和光照语义。
- 相邻 nova-v2 当前工作树公开 Material 也没有这些字段。结论针对已检查的本地工作树和锁定发布包，不代表其他分支。

## nova-render 需要补充

沿用现有 slot + assetId 的 Get/SetMaterial，C++ 与 Web 同步增加：

- `alphaMode`：`OPAQUE | MASK | BLEND`，默认 OPAQUE。C++ 可用等价 enum。
- `alphaCutoff`：有限浮点 [0,1]，默认 0.5，仅 MASK 生效。
- `doubleSided`：bool，默认 false。
- `baseColor[3]`：[0,1]，作为不透明度；不需要重复的 opacity 字段。

加载 GLB 与运行时更新必须使用同一套字段、默认值和校验。编辑材质不能要求删除实例或重新导入模型；getter 返回真实当前值。非法更新整次拒绝并保留原材质。改变材质后，光追累积应失效。

### 必须具有的真实渲染行为

1. OPAQUE 忽略因子/贴图的 alpha，保持不透明。
2. MASK 使用 `baseColor.a * baseColorTexture.a`，小于 cutoff 时丢弃，否则按不透明绘制；透明孔洞不能写深度或遮挡后面的物体。
3. BLEND 使用相同 alpha 值混合，能透出后方几何体。需要正确的深度测试、透明深度写入策略和跨实例/子网格排序（或文档化的 OIT）；要明确相交透明体的限制。覆盖 PBR 与 Unlit，不能只改 canvas 的 alpha 配置。
4. 单面时剔除背面；双面时保留背面并翻转背面着色法线，法线贴图的切线空间保持一致。非等比/镜像实例变换、父级负缩放不能使前后面判断错乱。
5. MASK 的可见性必须与阴影、光追射线一致，避免孔洞变成实心阴影或射线遮挡。BLEND 的阴影/光追行为如暂不支持，应通过能力查询或明确限制报告，不能把视觉透明当作玻璃折射。
6. 对外报告逐后端、逐渲染模式的 opaque/mask/blend/double-sided、alpha 阴影与透明排序能力。编辑器只开放当前模式可用的项，不能在切光追后静默变回 opaque。
7. 拾取语义明确：三角形命中是否遵循单面、MASK 贴图孔洞及 BLEND alpha 阈值。如果 PickScene 暂为纯几何拾取，明确报告限制；不能声称与可见像素完全一致。

最小验收目标为 macOS Metal 与 Chrome WebGPU 光栅；其他后端和 PT/BDPT/Photon 若暂未支持，必须真实报告。发布同一干净提交的 native 库/头文件与 Web 模块/着色器配对包，不混用旧二进制。

## 编辑器接入范围（正式 SDK 到位后）

- 双端材质槽面板：模式、不透明度、MASK 阈值、双面。隐藏不适用阈值输入，解释当前后端限制。
- 扩展编辑器 Material DTO、校验与 SDK 预览桥接。目前编辑器会把 baseColorFactor.a 写成 1，必须一起修正。
- 写入不可变 GLB 资产版本：`material.alphaMode / alphaCutoff / doubleSided` 及 `pbrMetallicRoughness.baseColorFactor[3]`。共享/独立材质、历史、ZIP、另存为和恢复继续走现有资产流程；这些是 glTF 材质字段，本身不需要新增 scene schema 版本。
- 放开静态模型内部展开时的非 OPAQUE 拒绝，保留每个槽的模式和贴图；不是无条件删掉保护，要以 SDK 能力为前提。
- 现有 GLB 导出器保留 material JSON 和贴图，新增双端 roundtrip 测试，证明修改后的透明/裁剪/双面字段未在读取、展开、预览或重组导出时丢失。
- 旧资产缺字段时按 glTF 默认：OPAQUE、cutoff 0.5、单面、alpha 1；切模式时保留用户设置的不透明度和阈值。

## 验收夹具

- 两层重叠半透明平面，在前后相机角度下检查混合排序；分别位于同一模型的两个槽和不同实例。
- RGBA 棋盘贴图裁剪，修改阈值改变孔洞；后景、深度、阴影与射线能力逐项核对。
- 单面/双面平面正反面，含法线贴图、负缩放和父级镜像。
- 两个材质槽独立设置；编辑、撤销、共享资产实例、Make unique、保存恢复、GLB 导出重开后字段与贴图 alpha 字节一致。

当前已实现双端材质编辑，并以不可变 GLB 资产保存 Alpha 字段；保存/恢复与选中/完整场景 GLB 导出重开测试已补充。
