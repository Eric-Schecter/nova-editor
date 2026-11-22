#pragma once

#include "Assets.hpp"
#include "Transforms.hpp"
#include <future>
#include <imgui.h>

namespace editor::assets
{
    struct PreviewRun
    {
        uint8_t x, y, length;
        ImU32 color;
    };

    constexpr int previewWidth = 104, previewHeight = 64;
    std::vector<PreviewRun> assetPreview(const std::filesystem::path& path);

    class AssetPreviews
    {
    public:
        void clear()
        {
            entries.clear();
            ++generation;
        }

        const std::vector<PreviewRun>* request(const std::filesystem::path& path)
        {
            if (job.valid() && job.wait_for(std::chrono::seconds(0)) == std::future_status::ready)
            {
                auto image = job.get();
                if (submittedGeneration == generation)
                {
                    if (entries.size() >= 128) entries.erase(entries.begin());
                    entries.emplace(submittedPath, std::move(image));
                }
            }
            const auto existing = entries.find(path);
            if (existing != entries.end()) return &existing->second;
            if (!job.valid())
            {
                submittedPath = path;
                submittedGeneration = generation;
                job = std::async(std::launch::async, assetPreview, path);
            }
            return nullptr;
        }

    private:
        std::map<std::filesystem::path, std::vector<PreviewRun>> entries;
        std::filesystem::path submittedPath;
        std::future<std::vector<PreviewRun>> job;
        size_t generation = 0, submittedGeneration = 0;
    };
}
