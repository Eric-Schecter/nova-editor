# Nova Editor

Nova Editor is a 3D scene editor for desktop and web, powered by Nova Render. Import models, arrange a scene, edit materials and lighting, then save the project or export it as GLB.

[Open the web editor](https://eric-schecter.github.io/nova-editor/) · [Download the desktop app](https://github.com/Eric-Schecter/nova-editor/releases)

![Nova Editor web editor showing geometric primitives with PBR materials](docs/screenshots/geometry-materials.png)

## Features

- Scene hierarchy, viewport picking, multi-object transforms, grid snapping, and surface placement.
- Editable materials, lights, and cameras. Aim lights in the viewport, preview animations, and switch between perspective and orthographic views.
- Import and export glTF, GLB, OBJ, and STL. Convert between FBX and GLB, and import STEP models.
- Shared project format and local recovery on desktop and web.

The interface defaults to English. To switch to Simplified Chinese, open **Settings → Language**.

## Run locally

Install Node.js and pnpm. Desktop builds also require CMake and a C++17 toolchain. The first build of the browser-based FBX converter requires Emscripten.

```sh
pnpm install --frozen-lockfile
pnpm sdk:install
```

**Web** — Run `pnpm dev:web`, then open the URL printed in the terminal in a WebGPU-capable browser.

**Desktop on macOS** — Build and launch the editor:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --target nova_editor -j 6
./build/nova_editor.app/Contents/MacOS/nova_editor
```

On Windows and Linux, find the executable in the build directory. The desktop app opens `project.json`, and the web editor opens project ZIP archives. To open a web project on desktop, extract the ZIP and open `project.json` with its `assets/` folder alongside it.

**Native mobile** — See [iOS and Android build instructions](apps/mobile/README.md).

See [SDK installation and version pinning](docs/SDK-DOWNLOAD.md), [Architecture](ARCHITECTURE.md), and [Validation](docs/VALIDATION.md) for details.
