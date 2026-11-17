# Alpha material integration

Implemented against the paired **Nova 0.8.0 GitHub Release SDK**, source `3fa5679c26fd12b28e078ca522779cce7a2a5dc8`. The native archive and npm archive share that clean revision. The lock records `github-release`, official asset IDs and SHA-256 hashes. [Download v0.8.0](https://github.com/Eric-Schecter/nova-render/releases/tag/v0.8.0).

Both inspectors expose OPAQUE / MASK / BLEND, opacity, alpha cutoff and double-sided rendering. GLB factors and material flags remain authoritative: importing, expanding submeshes, runtime previews, immutable asset versions, undo/redo and project ZIP save/reopen preserve the fields. The editor passes these values through the SDK; it contains no transparency shaders or render passes.

Rendering boundaries:

- OPAQUE ignores alpha; MASK uses factor × texture alpha and writes depth only for surviving fragments.
- BLEND uses weighted blended OIT. This is approximate layered transparency, without glass refraction or BLEND shadows.
- MASK supports cutout scene shadows. Double-sided raster back faces flip geometric and mapped normals; negative node/instance scales preserve the authored front side.
- MASK/BLEND require Raster mode. The SDK rejects unsupported Ray / AO or BLEND MSAA/TAA/split combinations before replacing state. Ray material sidedness and alpha-aware picking remain unsupported; picking is a geometry query.

Validation on Apple M4:

- SDK checksum verification: 221 files, paired 0.8.0.
- 84 TypeScript/Node tests; 11 native contract tests; web type-check and production build.
- Existing browser material, camera, shadow, environment and project workflows.
- `tools/check-material-alpha-browser.mjs`: actual alpha GLB import, rendered edits, sidedness, undo/redo, ZIP save/reopen.
- Native editor: alpha fixture loaded and rendered on Metal and Vulkan, zero validation errors.
- Renderer conformance suite: Metal, MoltenVK and Chrome WebGPU, 99 native regressions; Windows runtime remains deferred.

Update with `pnpm sdk:update 0.8.0`; restore the pinned installation with `pnpm sdk:install` (or `--offline` after caching). Use the paired installer rather than copying headers, libraries or shader files separately. Existing published 0.7.1 packages do not contain this feature.
