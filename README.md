# Nova Editor

原生桌面 **C++ / GLFW / ImGui / Nova SDK**，网页 **TypeScript / React / Nova WebGPU**。不使用 Electron、Qt 或 WASM。

已支持双端多模型场景：多个实例同时绘制，每个节点可以独立移动、旋转、缩放，支持父子变换、复制实例、撤销重做，以及项目保存/导出。相同资产的实例共享网格和纹理；调整变换会更新实例缓冲与阴影缓存，保持网格和纹理复用。

网页可点击“示例项目”加载两顶头盔与一个牛油果，选择节点后在 Inspector 编辑位置、XYZ 旋转（度）和缩放。项目内部仍保存四元数。桌面端同样提供 position / scale / rotation XYZ 和 Duplicate selection，名称按 Enter 或离开输入框提交。

当前支持静态不透明 GLB；动画模型实例尚未实现。原生场景已使用中央独立视口矩形，投影、点选与 gizmo 使用同一区域。桌面 UI 暂为英文。材质图集单资产瓦片上限 2048px，图集尺寸上限 8192px、CPU 预算 512 MiB；超出时明确报错。

## 界面布局

- 顶部为文件、编辑、添加、视图菜单；右侧统一为场景 / 项目 / 设置侧栏。
- 场景树位于属性上方，可拖动两者分界调整高度；分组、复制等操作收进编辑/右键菜单。
- 资源库默认收起，点击视口底部“资源库 / Assets”展开，不挤压右侧属性区；变换模式通过 W / E / R / H 快捷键切换。
- 网页的文件菜单提供示例、打开、保存和导入。桌面的文件菜单切换至项目页，在 Project path / GLB path 输入路径，再点 Open / Save / Import GLB。
- 项目页保留保存与资源入口，设置页控制现有视口选项和查看快捷键。当前只有已接通的功能入口；几何体与材质页已接通，动画播放条和脚本页后续加入。

## 几何体与材质

- 添加菜单创建立方体、平面、球、圆柱、圆锥、圆环。选择模型后，进入几何体页修改尺寸和分段，点击“应用几何体 / Apply geometry”；导入模型支持内部节点和子网格的独立编辑，暂不支持顶点/拓扑编辑或参数化重建。
- 材质页支持基础色、金属度、粗糙度、自发光、法线和遮蔽强度，以及基础色、法线、金属度/粗糙度、遮蔽、自发光五类 PNG/JPEG 贴图（单文件不超过 16 MiB）。网页选择文件；桌面输入本地贴图路径；最后点击“应用材质 / Apply material”。未应用的输入草稿不保存。
- 复制实例默认共享整个资产的几何体和材质。需要分别编辑时，先点击“独立副本 / Make unique”。导入模型按子网格保留独立材质槽；旧项目整体资产可先展开。当前仍仅支持不透明 PBR，透明/裁剪和自定义着色器后续接入。
- 每次应用生成不可变 GLB 版本，整次修改可撤销；几何参数保存在 GLB extras，贴图嵌入 GLB，项目保存、恢复及双端重开保留编辑结果。另存为同时复制撤销历史依赖的资源。
- 网页“文件 → 几何体示例”包含六种形状及内嵌棋盘贴图。运行 `npm run fixtures:primitives` 后，桌面可打开 `output/primitives-study/project.json`。

## 环境、背景与雾效

- 网页检查器“环境”、桌面“World”：导入 Nova `.nenv` 环境贴图，或选摄影棚 / 日落预设，支持旋转、环境光强度和背景亮度。HDR/EXR 需先经 SDK 离线转换。
- 背景可选纯色（sRGB 十六进制）或环境贴图；纯色背景时环境贴图仍参与模型光照与反射。雾支持关闭、线性（起止距离）和指数平方（密度），可编辑颜色。雾影响模型、地面和网格，天空保持原图；透视、正交和主相机预览均适用。
- 点击“应用场景环境 / Apply environment”提交草稿，支持撤销重做。导入贴图立即生效；移除贴图后点击应用，恢复摄影棚补光。
- 设置与贴图随项目保存、ZIP 导出、另存为及本机恢复；首次应用环境至少升级到 schema v4；含新镜头参数的 v5 项目保持 v5，继续读取 v1–v3。模型编辑、新建灯光/相机不会降级格式；旧编辑器不能读取 v4。另存为保留撤销历史使用的贴图。
- [SDK 依赖说明](docs/SDK-OWNERSHIP.md)记录配对包安装、校验和责任边界。

## 场景灯光与相机

- 添加菜单的“方向光 / Directional light”和“相机 / Camera”创建真实场景节点；首个相机自动成为主相机，首个方向光自动成为场景光源。节点支持树中重命名、隐藏/锁定、父子层级、复制、删除、gizmo 与撤销。复制节点不会抢占原有主相机或场景光源。
- 方向光对象页编辑局部方位/俯仰、线性颜色（界面输入 sRGB 十六进制）、强度 0–100、阴影开关及柔和度 0–4，点击“应用节点设置 / Apply node settings”提交。方向光位置只影响辅助图标；点光和聚光位置影响照明，聚光沿局部 -Z 照射。缩放不改变灯光范围。Metal / Vulkan / DX12 / WebGPU 光栅最多同时使用 16 盏方向光、点光或聚光；每灯独立启用。点光和聚光支持范围，聚光支持内外半锥角；点光/聚光支持逐灯硬阴影与软阴影（静态不透明实例）。关闭或隐藏全部场景灯时不会补回默认直射灯，环境照明独立保留。
- 相机对象页支持透视/正交、目标距离 0.05–100、正交视野高度 0.05–80、曝光 0.01–16，以及节点位置和朝向。“从编辑视角更新相机 / Capture editor view”记录当前编辑视角；“设为主相机 / Set main camera”切换项目的主相机。
- 点击“预览主相机 / Preview main camera”或视图菜单进入主相机画面；此时辅助线、gizmo 和相机导航停用，编辑器原视角保留。切换其他主相机或修改其参数会更新画面；点击“返回编辑视角 / Editor view”恢复原视角。打开、恢复项目保留主相机标记，默认使用编辑视角，按需进入预览。
- 视口显示可点选的相机示意视锥和方向光图标，可与其他节点整体变换；F 聚焦节点辅助体。辅助图形不作为网格资源保存或参与阴影。相机支持局部方位、俯仰、滚转以及完整 XYZ 变换；滚转沿用节点四元数保存，父节点旋转会影响最终朝向。视锥辅助体是示意，不表示真实远裁剪范围。
- 相机支持垂直 FOV 1–179°、近裁剪面 0.0001–1,000,000、远裁剪面 0.0002–10,000,000（远必须大于近），以及局部滚转 -180–180°。FOV 影响透视投影，正交投影使用视野高度。点击“应用节点设置 / Apply node settings”提交，一个操作可撤销，并立即更新主相机预览。灯光集合接口及限制见 [SDK-LIGHTS.md](docs/SDK-LIGHTS.md)。目标距离仅决定观察目标与正交换算，不提供景深。光照和相机的方向继承祖先旋转，节点位置继承完整父级变换；自身缩放不改变镜头或光照。
- 灯光/基础相机沿用 schema v3；应用镜头参数或捕获相机后升级到 v5，双端继续读取 v1–v4，旧相机保持 FOV 45°、裁剪 0.01–200 默认值。新增几何体、导入模型或修改环境不会降级格式。节点参数和唯一主相机/活动光标记纳入保存、本机恢复和撤销；编辑视角与预览状态不写入场景。旧版本编辑器不能读取它尚未支持的新版场景格式。
- 网页“文件 → 灯光与相机示例”；桌面运行 `npm run fixtures:scene-objects` 后打开 `output/scene-objects-study/project.json`。网页项目页另有“下载项目包”，用于直接导出 ZIP；下载不清除未保存标记与恢复副本，确认写入完成的文件选择器保存才更新保存基线。
- 变换数值输入按 Enter 或失焦时一次提交，避免逐字符重绘导致焦点丢失；“应用节点设置”只提交上方节点参数草稿。

## 多选整体变换

- 多选模型后直接使用 W/E/R gizmo；所有选中子树显示选择框。多个独立选择以可见模型联合世界包围盒中心为轴心；只有一个顶层选择时使用该节点原点。父子同时选中只处理顶层选择，不会重复移动。
- 右侧对象页提供“整体位移 / 整体旋转 / 整体缩放”增量，点击“应用整体变换 / Apply group transform”提交一次撤销记录。均匀缩放可拖 gizmo 中心方块；各轴数值均为 1 表示原大小。多选聚焦 F 会框住全部选择。
- 默认局部坐标。X、视图菜单或检查器下拉框切换坐标；局部轴沿最后选择节点的朝向，世界轴固定 XYZ。单选检查器数值也随坐标切换：局部 TRS 相对父节点，世界 TRS 相对世界原点。坐标选项属于编辑器会话，不写入项目或历史。
- 拖动始终相对冻结的起始场景计算，鼠标释放只提交一次；Esc、窗口失焦、视口缩放、选择或坐标切换取消未提交拖动。Shift 保留现有移动 0.25 单位、旋转 15°、缩放 0.1 的吸附。
- 场景格式仍为 TRS，不保存剪切矩阵。旋转对象的世界非等比缩放、复杂非等比父级下的某些旋转会产生剪切，整次操作明确拒绝；可改用局部轴或等比缩放。锁定节点/后代、隐藏的直接选择、不可逆父级和零缩放同样不允许整体变换。已有世界矩阵包含剪切时，世界数值页提示切回局部；gizmo 世界平移仍可使用。

## 模型内部节点与多材质槽

- 导入静态 GLB 自动展开原有节点层级，并将每个 primitive（材质槽）作为可选子网格。场景树或视口点选后，可独立移动、旋转、缩放、重命名、隐藏、锁定、复制和删除；父节点变换影响整个子树。
- 选择模型或内部父节点，在“材质 / Material”页查看下属子网格材质槽，点击某槽进入 PBR 与五类贴图编辑。修改一个槽不影响其他槽。原模型重复引用同一网格时仍复用子网格资源；若只想修改其中一个实例，先点击“独立副本 / Make unique”。不同 primitive 即使引用同一原始材质，展开后也按槽独立编辑。
- 旧项目中的整体模型：选择后进入“几何体 → 展开模型”；桌面为“Geometry → Expand model hierarchy”。展开仅作用于所选实例，并产生一条撤销记录；其他实例继续保留原资产。旧版归一化模型增加 Source normalization 节点以保持原外观。
- 原始局部坐标、层级与内嵌贴图保留；子网格资源仅打包引用的顶点缓冲、材质和图片。保存/恢复的是编辑器场景层级及独立 GLB 资源，不会改写源 GLB 文件，也不会重新合并为原始 GLB。
- 网页“文件 → 模型结构示例”通过真实 GLB 导入流程演示两个独立材质槽、父子节点、重复网格与棋盘贴图。`npm run fixtures:model` 生成桌面项目 `output/model-study/project.json`。
- 本轮仅支持静态、不透明、未压缩三角形；动画/蒙皮、形变目标、GLB 内部相机/灯光导入、稀疏数据及无法无损分解的剪切矩阵明确拒绝。展开预算为 4096 个节点、120 MiB 资源。Windows/Linux 尚未实机验证。

## 视口操作

- 两端默认启用 PBR 摄影棚光照：白色方向光（方向 -1 / 1.6 / 2，强度 3.5）与内置环境补光，保留灰色视口背景，无需额外 HDR 文件。网页视口上方“默认光照”和桌面“Lighting: On/Off”可切换材质原色查看；这是视口设置，不写入项目或撤销历史。
- 点击“光照设置 / Light settings”或检查器“光照 / Lighting”标签，可实时调整方向、颜色、强度、阴影开关与柔和程度。方位角范围 -180°–180°，高度角 5°–85°，方向均指向光源；颜色支持颜色选择器与十六进制输入，界面的 sRGB 颜色会转换为线性 RGB。强度范围 0–10，仅控制主方向光，摄影棚补光仍保留。阴影柔和度 0 为硬边、4 为柔和边缘；关闭阴影会保留光照。恢复默认值会同时重新启用光照与阴影。无活动场景光源时，这些摄影棚设置只保留在当前编辑器会话；持久化光照请添加方向光节点。活动场景光源优先，此面板提示选择节点编辑。
- macOS 桌面 Metal 和网页 WebGPU 默认显示方向光阴影，模型可投影到地面与其他模型。移动、旋转、缩放、落地及撤销后同步更新；关闭默认光照时进入无阴影的材质原色模式。地面接收层为与网格匹配的 40×40 米灰色平面，不进入场景树、全景范围或项目导出；网格和坐标轴不投射阴影。
- 从下方资源库把 GLB 卡片拖进视口：绿色包围盒和底面占位显示落点，释放创建并选中新实例；可拖到已有模型上连续堆叠，整个操作只产生一次撤销记录。预览不会写入场景或项目。
- 视口“网格吸附 / Grid snap”控制新实例的世界 X/Z 原点吸附，步长支持 0.1、0.25、0.5、1、2、5 米；拖入时按住 Shift 临时反转开关。保留资产原点，吸附后重新检测支撑面；底面范围脱离模型时回落 Y=0。
- Esc、失焦或在视口外释放取消摆放。前/侧正交视图也可拖到命中的模型上；未命中模型且射线平行于地面时不能放置，请切换顶视图或倾斜视角。
- 选中节点后点击 Inspector 的“一键落地 / Drop to surface”：向下查找模型支撑面，无支撑时落到 Y=0。整组落地排除自身及全部子节点，保留旋转、缩放和相对位置；支持撤销，重复落地不增加历史。缺少边界或父变换不可逆时不修改。
- 左键点击模型：按真实三角形拾取最近实例，场景树与 Inspector 同步；点击空白清除选择。
- **W / E / R**：移动、旋转、缩放。拖动彩色轴/旋转环；**X** 或右侧“坐标系 / Coordinates”切换局部与世界轴。局部 gizmo 使用活动节点的世界旋转朝向，世界模式固定 XYZ。
- 移动工具中央圆点：沿相机平面自由移动；缩放工具中央方块：等比缩放。
- **Shift**：移动按 0.25 本地单位、旋转按 15°、缩放按 0.1 吸附。
- **Esc**：取消正在拖拽的变换，恢复拖拽前状态；失焦/视口尺寸变化同样取消。桌面 Esc 不再直接关闭编辑器。
- 拖拽期间实时预览，释放鼠标只形成一次撤销记录；Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 重做。拖拽中按撤销先取消当前预览。
- H 切换平移工具，左键拖动平移；中键或 Shift+右键也可平移。W/E/R 返回对象编辑。
- F 聚焦选中对象及子树；Shift+F / Home 显示整个场景，也可从视图菜单操作。聚焦后围绕该对象中心环绕。
- 右键或 Alt+左键拖动：围绕相机目标旋转；滚轮缩放。相机距离范围 0.05–100 米。导航不会修改场景或产生撤销记录。

当前使用 CPU 三角形射线拾取，支持层级变换、非等比与镜像缩放；奇异变换不参与拾取。大网格的 BVH/GPU 拾取加速留待后续。选择框使用实际资产局部包围盒，并应用完整父子世界矩阵；包围盒内部空白不会被当作模型拾取。

摆放保持新实例直立，沿世界 Y 轴寻找底面覆盖范围内最高的支撑；一键落地仅查找当前底面以下的支撑（已在地下的对象仍恢复到地面）。两端使用变换后资产包围盒底面与候选模型重叠区域的 3×3 采样点，射线命中真实三角形，而非直接采用模型包围盒顶面。支持斜面、窄支撑和带父变换的模型，但复杂凹形、细小凸起及旋转模型的精确接触仍受采样和包围盒近似限制；不自动对齐表面法线，也不进行刚体碰撞或稳定性模拟。预览为线框占位。

删除某资产的全部实例后，资源库仍可再次拖入；未使用资源保留渲染边界缓存，占用既有图集预算，但不计入场景实例、拾取或导出节点。资产可选 `name` 字段仅用于资源库显示，兼容原有格式 2 项目。

## 本机运行

```sh
pnpm install --frozen-lockfile
pnpm sdk:verify
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j 6
./build/nova_editor.app/Contents/MacOS/nova_editor
pnpm dev:web
```

网页以终端实际输出地址为准；5173 若已占用会自动选择后续端口。macOS 已验证；Windows/Linux 可执行文件为 `build/nova_editor[.exe]`，本任务尚未构建验证。

桌面在右侧 Project 页输入 GLB 路径后点击 Import GLB。项目路径默认为 `output/workspace/project.json`，Project 页的 Save 保存到输入路径，Open 打开指定路径；也支持 `--project /absolute/path/project.json`。两端均支持 Ctrl/Cmd+S 保存项目。macOS 初始化 GLFW 可能切换工作目录，因此启动参数在创建窗口前解析为绝对路径。

## 场景树与保存保护

- 两端支持折叠、名称搜索（保留匹配节点的祖先）、Ctrl/Cmd 多选、Shift 范围选择、分组/解组、复制完整子树、批量删除和撤销/重做。网页可双击节点或 F2 重命名；桌面右键 Rename 后在 Inspector 输入，Enter 或失焦提交。Ctrl/Cmd+D 复制选中子树，Delete 删除，编辑文本时不会触发节点删除。新建项目同样检查未保存修改；桌面新项目使用独立的 Untitled 目录，避免复用原项目路径。
- 拖动节点行的中部将其设为子节点；上/下四分之一区域用于前后排序；拖到根级落区解除父级。右键菜单也提供上移/下移、隐藏/显示和锁定/解锁。网页行尾有隐藏和锁定按钮。
- 改父级、分组与解组保持世界变换；选择父子时只移动/复制顶层选择，避免重复处理。遇到循环、目标父级不可逆或 TRS 无法表达的剪切会拒绝整个操作。不会悄悄改变模型形状。
- `nodes` 数组中的相对顺序就是同级显示顺序；可选布尔字段 `hidden`、`locked` 默认 false，随项目保存。隐藏继承至后代，停止绘制、投影和参与表面摆放；锁定禁止直接属性编辑与视口选取/gizmo，结构操作也不会删除或移动含锁定后代的子树。整体变换也会检查锁定后代，避免通过父级间接移动锁定对象。锁定节点仍可在树中选择并解锁。
- 多选可直接整体移动、旋转和缩放，无需先分组。Ctrl/Cmd 在树或视口增减选择，树中 Shift 连选；单击已选模型会保留多选并将其设为活动节点，空白处单击清空选择。
- 桌面保存先验证资源、复制所需资产，再通过临时文件替换项目 JSON；失败不推进已保存基线。打开其他项目和关闭窗口时，未保存修改会弹出保存、放弃、取消；“保存后打开”会保存原项目，再打开目标项目。
- 桌面停止修改约 1 秒后写入包含模型的恢复副本，不覆盖正式项目；下次启动提供恢复入口。macOS 默认位置为 `~/Library/Application Support/NovaEditor/recovery`，Windows 使用 `%LOCALAPPDATA%/NovaEditor/recovery`，Linux 使用 `$XDG_STATE_HOME/nova-editor/recovery`（未设置时为 `~/.local/state/nova-editor/recovery`）。测试可用 `--recovery-dir /absolute/test/directory` 隔离。
- 网页停止修改约 800 ms 后将完整场景和资源写入当前站点的 IndexedDB；再次打开会列出恢复副本，恢复后仍需保存正式项目。清除站点数据会删除这些副本；这是本机恢复机制，不能替代项目文件。
- 网页“保存项目”优先使用浏览器文件写入 API，成功关闭写入流后才清除未保存标记；取消或失败不标记成功。不支持该 API 时回退为 ZIP 下载，因为无法确认下载是否完成，会保留未保存标记和恢复副本。浏览器离开提示继续有效。
- 自动恢复不记录正在拖动的临时预览；已提交操作按上述延迟保存，不能保证恢复崩溃前最后一秒的操作。此处临时文件替换用于防止部分 JSON 写入，不声称具备断电级事务持久性。

## SDK 安装目录

依赖安装在可见的 `deps/nova/`：`native/include/render/` 是桌面头文件，`native/lib/` 是静态库，`native/lib/cmake/Nova/` 是 CMake 配置，`web/src/` 和 `web/generated/` 是同版网页模块与着色器，`package/` 保留配对清单。`nova-sdk.lock.json` 锁定版本、来源及这些文件的哈希。

下载缓存及安装事务位于 `.cache/nova/`；网页的 `apps/web/public/sdk/` 是构建/启动时从 `deps/nova/web/` 生成并校验的部署副本。正式依赖与部署副本均可重建，不提交 Git。静态库链接进桌面可执行文件，运行时不依赖相邻 nova-v2 工程。

## SDK 依赖与分工

渲染由 nova-render 0.6 的 native/Web 配对包提供；编辑器负责项目、交互、保存和资源版本。已替换多实例/原始空间、完整相机与视口、BVH 拾取、多材质槽、GPU 场景阴影、雾和环境清除，旧私有渲染补丁已退役。详细边界和验收见 [SDK-OWNERSHIP.md](docs/SDK-OWNERSHIP.md)。

```sh
pnpm sdk:install
pnpm sdk:verify
# 检查候选版本，不修改依赖
pnpm sdk:update --check
```

当前包来自 [GitHub Release v0.6.0](https://github.com/Eric-Schecter/nova-render/releases/tag/v0.6.0)，可通过上方命令直接下载安装。安装器校验包 SHA-256、平台/架构和配对来源；`deps/nova/` 为可重建安装目录，网页 `public/sdk/` 为部署副本。材质面板调用正式运行时 API，同时保留 GLB 版本、撤销和项目恢复。nlohmann/json 3.12.0 是编辑器自己的序列化依赖，头文件与许可随仓库保存在 `third_party/nlohmann-json/`，不再依赖未跟踪的 `.sdk/support`。

默认安装严格恢复锁文件，升级需显式执行 `pnpm sdk:update <精确版本>`；支持缓存、`pnpm sdk:install --offline`、配对来源校验与失败回滚。详见 [下载、锁定和更新](docs/SDK-DOWNLOAD.md)。

SDK 使用 UI 回调提交 ImGui 控件；不可在回调内重入 Renderer。应用把文件和渲染操作排队到 DrawFrame 之后执行。回调使用安装包中的相同 ImGui 版本。公共头变更影响 ABI，不能拿旧二进制搭配新头文件。

表面堆叠使用正式 `Ray.includeIds/excludeIds` 与 BVH 拾取，过滤先于最近命中，辅助体、隐藏对象和选中子树由编辑器决定排除。

场景阴影使用正式 `SetShadows` / `setShadows`，由 GPU 遍历共享 BVH 计算，不再维护 CPU 深度贴图。`castShadow` 默认 true，编辑器辅助体与不可见资源占位实例设为 false；柔和度 0 为硬阴影，范围 0–4，采样 1–16，偏移按世界单位设置。该接口与独立 ShadowView 实验示例分开。当前验证 Metal、macOS Vulkan/MoltenVK 和 Chrome WebGPU；Windows/Linux 真机仍需单独验收。

## 项目互通

统一以 `project.json` + `assets/` 表示项目。新项目 schemaVersion=2，继续读取格式 1；右手、Y 向上、米制，四元数为 `[x,y,z,w]`。本地变换为 `T*R*S`，世界矩阵为 `parentWorld*local`。新导入资产记录 `sourceSpace:true`，保留 GLB 尺寸和原点。SDK 为 GPU 实例和 CPU 拾取统一恢复原始模型空间。旧资产未标记时保持归一化布局；给旧项目导入新模型，在同一条可撤销命令中升级至格式 2，旧资产不改变。格式 1 不允许 sourceSpace:true，旧版本编辑器会拒绝格式 2，避免静默误读。

网页项目 ZIP 解压后可由桌面打开 `project.json`，也可使用配套工具：

```sh
node --import tsx tools/project.mjs unpack /path/to/nova-project.zip output/imported-project
./build/nova_editor.app/Contents/MacOS/nova_editor --project output/imported-project/project.json
node --import tsx tools/project.mjs pack output/workspace/project.json output/native-project.zip
```

`unpack` 只创建新目录，校验所需资产后提取，不覆盖已有目录。浏览器导入/导出项目在本机完成，不上传服务器。

## 多实例示例与验证

网页访问开发服务器后点击“示例项目”。桌面可打开同一归档：

```sh
node --import tsx tools/project.mjs unpack apps/web/public/demo/project.zip output/instance-example
./build/nova_editor.app/Contents/MacOS/nova_editor --project output/instance-example/project.json
./build/scene_render_test ../nova-v2/assets metal
./build/scene_render_test ../nova-v2/assets vulkan
./build/picking_test tests/fixtures/triangle.glb metal
./build/picking_test tests/fixtures/triangle.glb vulkan
```

回归会连续改变实例 TRS、增删实例、清空场景，并切换旧模型接口；需真实桌面/GPU 环境。

## 验证

```sh
pnpm test
ctest --test-dir build --output-on-failure
pnpm build:web
pnpm sdk:verify
MTL_DEBUG_LAYER=1 ./build/nova_editor.app/Contents/MacOS/nova_editor --frames 120 --project output/imported-project/project.json
```

本次实测记录见 [docs/VALIDATION.md](docs/VALIDATION.md)。[ARCHITECTURE.md](ARCHITECTURE.md) 记录工程方向，[packages/render-contract/README.md](packages/render-contract/README.md) 记录当前渲染边界与下阶段接口。

## 界面风格与视图

桌面与网页默认采用 D「中性黑白」主题：深灰面板、灰白选中态、中性灰场景背景（#999999），轴线保留红 X / 绿 Y / 蓝 Z。桌面通过 SDK 一次性 `configureUI` 回调在字体图集上传前配置主题与系统字体；字体文件不随项目分发。网页使用系统字体与 SVG 图标。

视口显示 XZ 地面网格（1 单位间距，每 5 单位加粗，范围 ±20）、原点坐标轴与左下角方向指示。右上角视图立方体随相机转动，点击可见面会进入对应的正交视角，顶底方向精确为 ±90°。视图菜单可恢复默认观察方向；切换投影模式按钮或 `P` 键可以在当前朝向上切换透视与正交。正交视野高度为 `2 × distance × tan(22.5°)`，切换时保持目标平面处的显示比例，滚轮控制缩放，点选与三种 gizmo 使用相同投影。投影属于编辑器视口状态，不修改场景历史。

辅助几何体只送入渲染器，不能作为场景节点选中，也不会进入保存与导出。辅助资源由 `node tools/viewport/generate.mjs` 从代码生成，供两端共用；CMake 将其复制到桌面应用 Resources，网页从 public/viewport 加载。正交模式用于编辑器当前的栅格渲染路径。

## 真实尺寸校验场景

网页点击“尺寸示例”，加载 1×1×1 米立方体和 2×3×1.5 米立柱。两者底部位于同一地面；立方体根节点有非零偏移，用来检查原点没有被自动居中。Inspector 显示原始尺寸。示例由代码生成，不需要下载外部模型。

```sh
node tools/fixtures/units.mjs
./build/nova_editor.app/Contents/MacOS/nova_editor --project "$PWD/output/units-study/project.json"
MTL_DEBUG_LAYER=1 ./build/source_space_test "$PWD/tests/fixtures"
```

原生可用 `--api auto|metal|vulkan|dx12` 选择后端，例如 `build/nova_editor.app/Contents/MacOS/nova_editor --api vulkan --project /path/to/project.json`。0.6.0 已验证 macOS Metal/Vulkan 与 WebGPU 多灯，DX12 仅完成共享 HLSL 的 DXIL 编译，Windows 实机验证暂缓，未发布新版 Windows SDK。

视口工具栏支持光栅 / 光追切换；多实例场景可直接使用方向光、点光和聚光。光追默认 PT、3 次反弹、50% 分辨率与降噪，模式是当前视口设置，不改项目文档。静态世界变换与材质更新重置累积；灯光修改不重新上传几何。Metal 使用硬件查询，缺少查询扩展的 Vulkan 与 WebGPU 使用计算 BVH（能力查询如实报告）。显式灯暂不发射 BDPT 光源子路径或光子。
