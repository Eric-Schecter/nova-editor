# Scene animation SDK integration (0.9.1)

The paired SDK now supplies asset clip discovery, independent per-instance playback, manual clocks, and posed bounds/picking. Existing editor animation UI is not implemented by this SDK update.

Use `GetAnimations(assetId)`, `Get/SetAnimationState(instanceId)`, `UpdateAnimations(deltaSeconds)`; Web uses lower camel case. Pass partial states on Web, full AnimationState on C++. Defaults are paused, clip 0, time 0, speed 1, loop true. Explicitly reset time when selecting clips. Paused seek accepts the final frame. Speed range is 0.1–4; invalid state/delta throws without changing state. Advance once in the editor frame loop; neither Window nor Web RAF advances scene animation.

SetScene preserves state only for unchanged instance ID, asset ID and asset path/URL. Removing/filtering an instance discards its SDK state; reintroducing starts paused at zero. Keep any desired hidden-object preview state in the editor. Material/transform edits preserve state.

`GetAnimationCapabilities()` reports skeletal and rigid node TRS support, posed raster shadows since 0.9.1, and the current limits for morph/CUBICSPLINE and animated Hybrid/ray modes. Scene instances honor the existing castShadow flag. Query `GetSceneInstanceBounds(id)` and PickScene against the current pose. Shadows and queries use the current CPU pose geometry, while raster vertices use shared HLSL GPU skinning.

Keep the existing protections for static GLB export and mesh splitting. Playback is preview state, separate from persisted authoring TRS and undo history.

Validated with the formal GitHub Release 0.9.0 pair (source `2e3754d79be2239ec1ffecfcf2b66404d82d1c08`): 224 installed files passed provenance/hash verification; 85 Node tests, 11 native CTest tests, Web build, desktop build, browser material/environment/camera/project checks and a 30-frame Metal startup passed with zero validation errors. Renderer package consumers separately exercised the new per-instance APIs on Metal, Vulkan and Chrome WebGPU. Windows runtime remains deferred.
