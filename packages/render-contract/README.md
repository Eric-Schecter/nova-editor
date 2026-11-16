# Render contract — current adapter and upstream migration

The descriptions below document the currently installed local-dev snapshot, not guaranteed official Nova Render APIs. Rendering implementation belongs to nova-render; editor documents, commands and interaction policies remain here. See [ownership and acceptance](../../docs/SDK-OWNERSHIP.md) and [migration inventory](migration.json). Upstream is currently formalizing scene instances and original model space; no replacement has yet passed editor acceptance.

## Current static scene instances

Both adapters now render every model node together, with one depth buffer and independent world transforms. CPU asset data, packed mesh ranges and material atlas textures are shared by all instances of an asset. Updating TRS updates the GPU instance buffer; it does not reload GLBs or rebuild textures. Adding/removing the last reference to an asset rebuilds the packed asset set.

Native SDK: `Window::SetScene(vector<SceneAsset>, vector<SceneInstance>)` (also exposed on Renderer). Web SDK: `renderer.setScene([{id,url}], [{id,assetId,world}])`. Matrix layout is column-major, affine world matrices; normal matrices use inverse transpose. Grouped hardware instanced draws share each asset's vertex range. Stable instance IDs are distinct from asset IDs.

The editor owns hierarchy, local TRS and undo/redo. It computes `parentWorld * T * R * S` and sends world matrices. Both cores consume the same transform fixture. Rotation is persisted as normalized `[x,y,z,w]` quaternion and edited as XYZ Euler degrees.

Current limits: raster only for scene instances; static opaque GLB assets with the same material constraints as Nova's existing loader. Animated assets are rejected explicitly. Materials use a shared atlas with 2-pixel gutters, maximum 2048px per asset tile, 8192px atlas dimensions and a 512 MiB CPU atlas budget. Larger source textures are resampled. Asset topology changes can pause briefly while packing; no texture packing occurs during transform-only edits.

The legacy single-model and path tracing APIs remain available. `SetScene` selects raster mode; path tracing capability queries explain that scene instances use raster. Empty scenes clear the viewport instead of drawing the example triangle.

SDK implementation: CPU nearest-triangle picking via `PickScene(Ray)` / `pickScene({origin,direction})`, normalized-model selection boxes, translate/rotate/scale gizmos and one-gesture undo transactions. Pick results contain stable instance ID, world position and distance; inverse world rays preserve nearest-hit ordering under nonuniform and mirrored scales. The editor starts rays at the camera near plane and filters hits beyond the far plane.

Upstream rendering work: offscreen viewport textures, BVH/GPU query acceleration and generic outline support. Editor work: docking, selection visuals and interaction policy. ImGui callbacks submit UI only; renderer mutations remain queued until after DrawFrame.

Source-space extension: SceneAsset adds sourceSpace=false; web accepts {id,url,sourceSpace:false}. Opt-in true restores original GLB dimensions and origin through an effective instance world matrix, shared by raster and picking; normalized mesh buffers remain shared. GetSceneAssetBounds/getSceneAssetBounds returns actual local bounds in the selected coordinate space. Scene format 2 supports this flag; legacy format 1 stays normalized. Changing only the flag recomputes instances without repacking unchanged topology. Public native layout changes require matching headers and binaries.

Native viewport extension: ParameterPanelConfig.sceneViewport returns {x,y,width,height} in ImGui logical pixels after drawUI. Metal/Vulkan/DX12 map this rectangle to viewport/scissor and use its aspect ratio. Editor input uses viewport-local coordinates; overlays add the viewport origin. sceneTopInset remains the fallback for other Nova consumers.

Editor input contract: left click picks; right or Alt+left orbits. W/E/R select tools, Shift snaps, Escape cancels. Gizmo axes now follow the selected Local/World coordinate mode. Selection transforms use an orthonormal active-node rotation frame or fixed world axes and reject edits that introduce unrepresentable local shear. Frozen drag baselines avoid incremental drift; focus loss/resize cancel. SDK `Window::SetCloseOnEscape(false)` reserves Escape for editor transactions while other Nova consumers retain their default Escape-to-close behavior.

## Editable model primitives

The installed local-dev SDK keeps its single compatible material core per render asset. This is a transitional asset adapter: nova-render owns formal runtime material slots and updates, while nova-editor keeps authoring, Make unique and old-project compatibility. The editor now expands imported static GLBs into authored node transforms plus one single-material asset per mesh primitive. Primitive-local geometry is retained in source units; editor hierarchy supplies all node/world transforms. Repeated mesh/primitive references share a render asset and retain separate instance IDs, enabling direct submesh picking and gizmos. Independent material slots are rendered as separate assets without silently flattening their PBR factors or textures. Make unique isolates a repeated primitive instance before editing. Saved scenes use the same v2 asset/node schema; no SDK update is required.

## Selection transform transactions

Multiple selected subtrees use a shared pivot and one frozen world-space delta. Ancestor/descendant selections are deduplicated before updating roots; all descendant instances inherit the resulting matrices. The renderer still receives the existing stable instance IDs and world matrices through SetScene/setScene, so geometry and texture resources remain shared. Local/World coordinate choice, selection bounds and numeric delta inputs are editor state. No new SDK ABI, node grouping or scene version is required.

## Saved light and camera nodes (scene v3)

The editor maps one active directional-light component to existing SetDirectionalLight/setDirectionalLight plus shadow settings, and one primary camera component to OrbitCamera/setCamera during explicit preview. Camera translation comes from the full hierarchy, orientation from its rotation chain; object scale does not stretch the lens or light direction. Orthographic height converts to orbit distance using tan(22.5 degrees). Unsupported camera roll is detected before calling Nova. The installed SDK ABI and hashes remain unchanged; fixed FOV/clipping and one direct light remain explicit limits.

The document persists components, not GPU handles, preview flags or editor navigation. Editors continue to read legacy v1/v2, and write v3 when components are introduced. Camera/light markers and schematic frusta are editor overlays with screen-space picking, not renderer assets. No GLB camera/light import is claimed by this component implementation.

## World settings (scene v4)

World document validation, .nenv asset ownership, undo, ZIP, SaveAs and recovery belong to the editor. The installed atmosphere extension supplies runtime environment clear and raster fog; fog implementation and uniform/shader layouts belong to nova-render. Keep the installed paired snapshot until official replacements pass cross-platform editor regression. Background/color parameters and authored world data are converted by the adapter, not exposed as editor schema types in the rendering library.
