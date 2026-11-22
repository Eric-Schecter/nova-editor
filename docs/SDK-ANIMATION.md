# 编辑器场景动画接口需求

状态：2026-11-17，已核对锁定的0.8.0包及相邻nova-v2公开接口；尚不能接入多实例场景动画。

## 当前能力与阻断

`GetAnimations/GetAnimationState/SetAnimationState/UpdateAnimation`（Web对应小写方法）已经提供片段名称、duration，以及clip/time/speed/playing/loop。但方法没有assetId或instanceId；Web内部读取单个model。编辑器使用SetScene多实例路径，Web SceneData明确拒绝data.animation，原生SceneData同样拒绝动画资产，Renderer接口也注明static scene。不能以单模型播放预览替换整个编辑场景来声称完成。

## nova-render需要提供

接口名为建议，最终以正式配对包为准。

- 允许SetScene载入动画资产，保留已有静态实例、材质、光照、相机；至少支持骨骼动画，并明确节点TRS动画、morph动画的支持情况。
- `GetAnimations(assetId)`：按资产查询稳定片段索引/名称和秒制时长。
- `GetAnimationState(instanceId)`、`SetAnimationState(instanceId,state)`：同一资产的两个实例独立选择clip、time、speed、playing、loop，几何/贴图可共享，姿态不能串扰。
- `UpdateAnimations(deltaSeconds)`或等价明确的时钟接口：本轮由编辑器推进，避免Window自动更新与Web RAF重复推进。暂停后设置time必须立即更新姿态，不必先播放；切片段建议重置到0，seek末帧不应立刻循环回首帧。
- 明确clip越界、时间钳制/循环、speed范围（本轮编辑器需0.1–4倍正速）、空片段、非法数值的校验；失败保留旧状态。删除实例、重建SetScene、切材质/模式时状态保留或失效规则一致。
- 能力查询按后端/模式报告骨骼、节点TRS、morph、动态阴影、拾取/边界、光追的支持范围。动画姿态对应边界和拾取不能悄悄沿用绑定姿势；暂不支持的能力要明确限制。
- 同一干净提交的native/Web正式Release配对包，C++头文件/静态库与Web模块/预编译shader同步；现有单模型接口保留兼容。

## 编辑器接入与验收

- 选中模型实例显示片段下拉、播放/暂停、时间滑条/秒数、0.1–4倍速度、循环与回到起点。无片段时不提供无效控制。
- 播放时钟与对象TRS编辑隔离；不把每帧姿态写入历史。预览播放状态默认不改项目文档，脚本Play/Stop与动画资源序列化另行定义。
- 不自动将带骨骼/动画模型拆成静态子网格；当前模型展开与静态GLB导出保护继续保留，直到动画导出契约完成。
- 双端同一夹具：至少两个片段和两个共享资产实例，一个暂停定位、另一个播放；切片段、seek首尾、暂停改时间、倍速与循环、隐藏/删除、更新其他对象后状态保持。实际GPU验证姿态改变，不能仅检查state字段。

本轮完成接口审查；上述实例动画能力是双端编辑器接入的前置条件。未新增空控件或修改SDK私有着色器。
