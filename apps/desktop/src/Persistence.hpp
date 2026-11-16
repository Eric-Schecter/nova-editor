#pragma once
#include "World.hpp"
#include <cstdlib>
namespace editor
{
    inline std::filesystem::path defaultRecoveryRoot()
    {
#ifdef _WIN32
        if (auto value = std::getenv("LOCALAPPDATA"))
            return std::filesystem::path(value) / "NovaEditor/recovery";
#elif defined(__APPLE__)
        if (auto value = std::getenv("HOME"))
            return std::filesystem::path(value) / "Library/Application Support/NovaEditor/recovery";
#else
        if (auto value = std::getenv("XDG_STATE_HOME"))
            return std::filesystem::path(value) / "nova-editor/recovery";
        if (auto value = std::getenv("HOME"))
            return std::filesystem::path(value) / ".local/state/nova-editor/recovery";
#endif
        return std::filesystem::absolute("output/recovery");
    }
    inline std::filesystem::path safeAssetPath(const std::filesystem::path& root, const std::string& path)
    {
        auto base = std::filesystem::weakly_canonical(root), full = std::filesystem::weakly_canonical(root / path),
             rel = full.lexically_relative(base);
        if (rel.empty() || *rel.begin() == "..")
            throw std::runtime_error("Asset escapes project directory");
        return full;
    }
    inline void verifyAssets(const Json& scene, const std::filesystem::path& root)
    {
        validate(scene);
        for (const auto& path : projectPaths(scene))
            if (!std::filesystem::is_regular_file(safeAssetPath(root, path)))
                throw std::runtime_error("Missing asset: " + path);
    }
    inline void copyAssets(const Json& scene, const std::filesystem::path& root, const std::filesystem::path& dest)
    {
        verifyAssets(scene, root);
        for (const auto& path : projectPaths(scene))
        {
            auto src = safeAssetPath(root, path), target = safeAssetPath(dest, path);
            if (src != target)
            {
                std::filesystem::create_directories(target.parent_path());
                auto tmp = target;
                tmp += ".tmp";
                std::filesystem::copy_file(src, tmp, std::filesystem::copy_options::overwrite_existing);
#ifdef _WIN32
                if (!MoveFileExW(tmp.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
                    throw std::runtime_error("Cannot replace asset");
#else
                std::filesystem::rename(tmp, target);
#endif
            }
        }
        if (
          std::filesystem::is_regular_file(root / "LICENSES.txt")
          && std::filesystem::weakly_canonical(root) != std::filesystem::weakly_canonical(dest))
            std::filesystem::copy_file(
              root / "LICENSES.txt", dest / "LICENSES.txt", std::filesystem::copy_options::overwrite_existing);
    }
    inline void saveProject(const std::filesystem::path& path, const Json& scene, const std::filesystem::path& root)
    {
        validate(scene);
        auto dest = std::filesystem::absolute(path).parent_path();
        std::filesystem::create_directories(dest);
        copyAssets(scene, root, dest);
        save(path, scene);
    }
    struct RecoveryData
    {
        Json                  scene, saved;
        std::filesystem::path originalPath, root;
    };
    inline void saveRecovery(
      const std::filesystem::path& folder,
      const Json&                  scene,
      const Json&                  baseline,
      const std::filesystem::path& originalPath,
      const std::filesystem::path& assetRoot)
    {
        validate(scene);
        validate(baseline);
        std::filesystem::create_directories(folder);
        copyAssets(scene, assetRoot, folder);
        // Metadata is unchanged during a dirty session. project.json is the commit marker.
        auto metadata                    = baseline;
        metadata["recoveryOriginalPath"] = std::filesystem::absolute(originalPath).string();
        save(folder / "baseline.json", metadata);
        save(folder / "project.json", scene);
    }
    inline RecoveryData readRecovery(const std::filesystem::path& folder)
    {
        auto scene = read(folder / "project.json"), baseline = read(folder / "baseline.json");
        verifyAssets(scene, folder);
        auto original = baseline.at("recoveryOriginalPath").get<std::string>();
        baseline.erase("recoveryOriginalPath");
        return {scene, baseline, original, folder};
    }
} // namespace editor
