# nlohmann/json 3.12.0

Vendored header-only dependency used by the editor scene document code, independent of Nova Render.

Upstream: https://github.com/nlohmann/json/tree/v3.12.0
License: MIT, retained in LICENSE and source headers.

These headers preserve the previously used 3.12.0 SDK-support copy. Keeping this editor dependency in the repository allows a clean checkout to restore the renderer only from GitHub Release, without requiring an existing Nova/vcpkg build or an untracked `.sdk/support` directory. Update these headers and the license together after review.
