# Downloaded dependencies

`nova/` is the visible, rebuildable Nova Render SDK installation. It is ignored by Git; commit `nova-sdk.lock.json` instead.

- `nova/native/`: native headers, static libraries and CMake package files.
- `nova/web/`: paired Web modules and precompiled shader assets.
- `nova/package/`: paired release manifest and package metadata.

Run `pnpm sdk:install` to restore the exact locked version, or `pnpm sdk:update <exact-version>` to change it explicitly. Download/transaction state lives in `.cache/nova/`. The Web public SDK is generated from `nova/web/` during dev/build.

See [SDK download and locking](../docs/SDK-DOWNLOAD.md).
