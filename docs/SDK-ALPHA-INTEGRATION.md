# Alpha material integration

Implemented against the paired **local Nova 0.8.0 SDK**, source `f4853b00ad43c96dcce7d162f5be9add85bc5db2`. The native archive and npm archive share that clean revision. This package is not a GitHub Release yet; the lock explicitly records `local-package`.

Both inspectors expose OPAQUE / MASK / BLEND, opacity, alpha cutoff and double-sided rendering. GLB factors and material flags remain authoritative: importing, expanding submeshes, runtime previews, immutable asset versions, undo/redo and project ZIP save/reopen preserve the fields. The editor passes these values through the SDK; it contains no transparency shaders or render passes.

Rendering boundaries:

- OPAQUE ignores alpha; MASK uses factor × texture alpha and writes depth only for surviving fragments.
- BLEND uses weighted blended OIT. This is approximate layered transparency, without glass refraction or BLEND shadows.
- MASK supports cutout scene shadows. Double-sided raster back faces flip geometric and mapped normals; negative node/instance scales preserve the authored front side.
- MASK/BLEND require Raster mode. The SDK rejects unsupported Ray / AO or BLEND MSAA/TAA/split combinations before replacing state. Ray material sidedness and alpha-aware picking remain unsupported; picking is a geometry query.

Validation on Apple M4:

- SDK checksum verification: 221 files, paired 0.8.0.
- 83 TypeScript/Node tests; 11 native contract tests; web type-check and production build.
- Existing browser material, camera, shadow, environment and project workflows.
- `tools/check-material-alpha-browser.mjs`: actual alpha GLB import, rendered edits, sidedness, undo/redo, ZIP save/reopen.
- Native editor: alpha fixture loaded and rendered on Metal and Vulkan, zero validation errors.
- Renderer conformance suite: Metal, MoltenVK and Chrome WebGPU, 99 native regressions; Windows runtime remains deferred.

Local renderer artifacts: `../nova-v2/build/packages/paired-080/manifest.json`. Use the paired installer rather than copying headers, libraries or shader files separately. Existing published 0.7.1 packages do not contain this feature.
