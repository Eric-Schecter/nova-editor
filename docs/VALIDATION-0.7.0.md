# Nova SDK 0.7.0 acceptance

The editor installs the paired macOS ARM64 / WebGPU archives from the official v0.7.0 Release, source 11e658bb8807435c1ed2693ad938df4659f7ddc8. All 205 installed/deployed files pass hash verification. No SDK source is patched.

- 78 JavaScript tests and 10 native contract tests pass; TypeScript, Vite and native builds pass.
- Metal and Vulkan each complete 120 native UI frames with PT / BDPT / Photon mapping selection, point-light toggle/undo, spot-cone edits and instance movement; zero GPU errors.
- Chrome WebGPU passes BDPT / photon mode switching, light edit/undo, independent material changes and raster return. Existing material, camera, shadow, fog and project ZIP restoration tests pass.
- Renderer validation covers non-emissive Cornell scenes, glass caustics, source range/disabled state, mixed area emitters with 16 local lights and standalone SDK consumers. Metal uses hardware rays; Mac Vulkan uses compute BVH.

Source-light types are point and spot; directional lights remain camera-path NEE. Photon density estimates retain finite-budget caustic bias, so sharp-caustic pixel MSE is reported without claiming monotonic improvement or pixel-identical results. Windows runtime validation remains deferred.

Local logs and captures are ignored build artifacts under output/source-*.log and output/ray-mode-browser/. Integrator selection is viewport state and is not serialized into project documents.
