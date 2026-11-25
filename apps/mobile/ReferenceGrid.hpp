#pragma once

#include "Assets.hpp"

namespace mobile
{
    inline void writeReferenceGrid(const std::filesystem::path& path)
    {
        using editor::Json;
        using editor::assets::Bytes;

        constexpr float extent = 8.f;
        Bytes bytes;
        Json primitives = Json::array(), views = Json::array(), accessors = Json::array();
        Json materials = Json::array();
        constexpr std::array<std::array<float, 4>, 3> colors{{
          {.18f, .20f, .22f, 1.f}, {.60f, .11f, .11f, 1.f}, {.10f, .25f, .63f, 1.f}}};

        constexpr float y = -1.01f;
        auto strip = [&](float offset, bool alongX, float halfWidth) {
            const std::array<std::array<float, 3>, 4> corners{{
              {-extent, y, offset - halfWidth}, {-extent, y, offset + halfWidth},
              {extent, y, offset + halfWidth}, {extent, y, offset - halfWidth}}};
            for (int index : {0, 1, 2, 0, 2, 3})
            {
                auto point = corners[index];
                if (!alongX) std::swap(point[0], point[2]);
                for (float value : point)
                {
                    uint32_t bits;
                    std::memcpy(&bits, &value, sizeof(bits));
                    const auto offset = bytes.size();
                    bytes.resize(offset + sizeof(bits));
                    editor::assets::put32(bytes, offset, bits);
                }
            }
        };
        for (int material = 0; material < int(colors.size()); ++material)
        {
            const auto start = bytes.size();
            if (material == 0)
            {
                for (int offset = -int(extent); offset <= int(extent); ++offset)
                    if (offset)
                    {
                        strip(float(offset), true, .012f);
                        strip(float(offset), false, .012f);
                    }
            }
            else
                strip(0.f, material == 1, .023f);
            const auto length = bytes.size() - start;
            views.push_back({{"buffer", 0}, {"byteOffset", start}, {"byteLength", length}, {"target", 34962}});
            const float x = material == 0 ? extent + .012f : material == 1 ? extent : .023f;
            const float z = material == 0 ? extent + .012f : material == 2 ? extent : .023f;
            accessors.push_back({{"bufferView", material}, {"count", length / 12}, {"componentType", 5126},
                                 {"type", "VEC3"}, {"min", {-x, y, -z}},
                                 {"max", {x, y, z}}});
            primitives.push_back({{"attributes", {{"POSITION", material}}}, {"material", material}});
            materials.push_back({{"pbrMetallicRoughness", {{"baseColorFactor", colors[material]}}},
                                 {"doubleSided", true}, {"extensions", {{"KHR_materials_unlit", Json::object()}}}});
        }
        Json document{
          {"asset", {{"version", "2.0"}}}, {"extensionsUsed", {"KHR_materials_unlit"}},
          {"scene", 0}, {"scenes", Json::array({{{"nodes", {0}}}})}, {"nodes", Json::array({{{"mesh", 0}}})},
          {"meshes", Json::array({{{"primitives", primitives}}})}, {"materials", materials},
          {"buffers", Json::array({{{"byteLength", bytes.size()}}})}, {"bufferViews", views}, {"accessors", accessors}};
        auto glb = editor::assets::writeGLB({document, bytes, {}});
        std::ofstream file(path, std::ios::binary);
        file.write(reinterpret_cast<const char*>(glb.data()), glb.size());
        if (!file) throw std::runtime_error("Cannot create the reference grid");
    }
}
