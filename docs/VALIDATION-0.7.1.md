# Nova SDK 0.7.1 acceptance

The editor installs the official paired macOS ARM64 / WebGPU release from source commit e81887041dc4. Verification checks all 205 installed/deployed files; no renderer or shader files are patched in the editor.

The patch fixes discarded dielectric NEE transmission, wrong-side BDPT visibility bias and hidden per-path radiance clipping. The fixed glass-spot audit reports approximately 0.16-0.17% mean disagreement between BDPT and photon mapping at its documented sample budget. Independent PT, block-standard-error bounds and photon-radius sweeps pass on Metal, Vulkan compute BVH and WebGPU. These measurements are fixture-specific, not a universal accuracy guarantee.

Editor validation passes 78 JS tests, 10 native contract tests, web/native builds, and 120-frame Metal/Vulkan UI runs covering PT/BDPT/photon selection, light edits/undo and instance movement with zero GPU errors. Browser regressions cover mode/integrator switching, runtime materials, environment/fog, cameras, shadows and project ZIP restore.

The renderer's single-interface transmission, real-blocker and high-intensity-linearity harness also passes when loaded directly from the editor's installed `/sdk/src` and `/sdk/generated` files. It does not import workspace renderer modules or generated shaders.

Logs are in ignored `output/caustic-*.log`; renderer audit logs are in its ignored `build/validation/caustic-audit/` directory. Windows runtime remains deferred; the patch does not include a Windows SDK. The public API and project schema are unchanged.
