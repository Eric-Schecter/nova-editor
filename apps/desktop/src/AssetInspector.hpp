#pragma once
#include "Language.hpp"
#include "Assets.hpp"
#include <imgui.h>
namespace editor
{
    struct AssetInspector
    {
        std::string                           key, error;
        std::optional<assets::GLB>            doc;
        std::optional<Json>                   geometry;
        Json                                  material;
        char                                  materialName[256]{};
        std::array<std::array<char, 1024>, 5> textures{};
        std::array<bool, 5>                   remove{};
        void                                  load(const std::string& nextKey, const std::filesystem::path& path)
        {
            if (key == nextKey)
                return;
            key = nextKey;
            doc.reset();
            geometry.reset();
            error.clear();
            textures = {};
            remove   = {};
            try
            {
                doc      = assets::readGLB(assets::readBytes(path));
                geometry = assets::geometryData(*doc);
                material = assets::materialData(*doc);
                std::snprintf(materialName, sizeof(materialName), "%s", material["name"].get<std::string>().c_str());
            }
            catch (const std::exception& e)
            {
                doc.reset();
                error = e.what();
            }
        }
        void draw(
          int                                                                               mode,
          size_t                                                                            users,
          bool                                                                              disabled,
          const std::function<void(Json)>&                                                  applyGeometry,
          const std::function<void(Json, std::array<std::string, 5>, std::array<bool, 5>)>& applyMaterial,
          const std::function<void()>&                                                      unique)
        {
            if (!doc)
            {
                ImGui::TextWrapped("%s", error.c_str());
                return;
            }
            ImGui::TextDisabled("Shared resource: %zu instances", users);
            ImGui::BeginDisabled(disabled || users < 2);
            if (ImGui::Button(editor::language::text("Make unique", "独立副本")))
                unique();
            ImGui::EndDisabled();
            ImGui::Separator();
            ImGui::BeginDisabled(disabled);
            if (mode == 1)
            {
                if (!geometry)
                {
                    ImGui::TextDisabled("Submesh geometry");
                    ImGui::Text("%zu meshes", doc->json.at("meshes").size());
                    ImGui::TextWrapped("Edit transforms with Object / gizmo; edit this slot in Material.");
                }
                else
                {
                    auto type = (*geometry)["type"].get<std::string>();
                    ImGui::TextUnformatted(type.c_str());
                    for (const auto& spec : assets::primitives().at(type))
                    {
                        ImGui::TextDisabled("%s", spec.label.c_str());
                        ImGui::SetNextItemWidth(-1);
                        if (spec.integer)
                        {
                            int value = (*geometry)["parameters"][spec.key].get<int>();
                            if (ImGui::InputInt(("##" + spec.key).c_str(), &value))
                                (*geometry)["parameters"][spec.key] = value;
                        }
                        else
                        {
                            double value = (*geometry)["parameters"][spec.key].get<double>();
                            if (ImGui::InputDouble(("##" + spec.key).c_str(), &value, .1, 1, "%.3f"))
                                (*geometry)["parameters"][spec.key] = value;
                        }
                    }
                    if (ImGui::Button(editor::language::text("Apply geometry", "应用几何体"), {-1, 29}))
                        applyGeometry(*geometry);
                }
            }
            else
            {
                ImGui::TextDisabled("%s", editor::language::text("Material", "材质"));
                ImGui::SetNextItemWidth(-1);
                ImGui::InputText("##MaterialName", materialName, sizeof(materialName));
                for (const auto& entry :
                     {std::pair<const char*, const char*>{"color", "Base color"}, {"emissive", "Emissive"}})
                {
                    float rgb[3];
                    for (int i = 0; i < 3; i++)
                        rgb[i] = assets::linearToSRGB(material[entry.first][i].get<double>());
                    ImGui::TextDisabled("%s", entry.second);
                    ImGui::SetNextItemWidth(-1);
                    if (ImGui::ColorEdit3(
                          (std::string("##") + entry.first).c_str(), rgb, ImGuiColorEditFlags_DisplayHex))
                        for (int i = 0; i < 3; i++)
                            material[entry.first][i] = assets::srgbToLinear(rgb[i]);
                }
                const char* alphaModes[] = {"OPAQUE", "MASK", "BLEND"};
                auto        alpha        = material["alphaMode"].get<std::string>();
                int         alphaIndex   = alpha == "MASK" ? 1 : alpha == "BLEND" ? 2 : 0;
                if (ImGui::Combo(editor::language::text("Alpha mode", "Alpha 模式"), &alphaIndex, alphaModes, 3))
                    material["alphaMode"] = alphaModes[alphaIndex];
                for (const char* field : {"opacity", "alphaCutoff"})
                {
                    float value = material[field];
                    if (ImGui::SliderFloat(field, &value, 0, 1, "%.2f"))
                        material[field] = value;
                }
                bool sided = material["doubleSided"];
                if (ImGui::Checkbox("Double sided", &sided))
                    material["doubleSided"] = sided;
                if (alphaIndex)
                    ImGui::TextWrapped(
                      "Raster only. MASK supports cutout shadows; BLEND uses weighted OIT and casts no shadow.");
                for (const auto& entry :
                     {std::pair<const char*, const char*>{"metallic", "Metallic"},
                      {"roughness", "Roughness"},
                      {"normalScale", "Normal scale"},
                      {"occlusion", "Occlusion strength"}})
                {
                    ImGui::TextDisabled("%s", entry.second);
                    ImGui::SetNextItemWidth(-1);
                    float value = material[entry.first];
                    if (ImGui::SliderFloat(
                          (std::string("##") + entry.first).c_str(),
                          &value,
                          0,
                          std::string(entry.first) == "normalScale" ? 4.f : 1.f,
                          "%.2f",
                          ImGuiSliderFlags_AlwaysClamp))
                        material[entry.first] = value;
                }
                ImGui::Separator();
                const char* labels[]{
                  "Base color texture",
                  "Normal texture",
                  "Metal / rough texture",
                  "Occlusion texture",
                  "Emissive texture"};
                for (size_t i = 0; i < 5; i++)
                {
                    ImGui::PushID(int(i));
                    ImGui::TextDisabled("%s", labels[i]);
                    ImGui::SetNextItemWidth(-1);
                    ImGui::InputTextWithHint(
                      "##TexturePath", "PNG / JPEG path", textures[i].data(), textures[i].size());
                    bool active = assets::hasTexture(*doc, assets::textureSlots[i]) && !remove[i];
                    ImGui::TextDisabled("%s", textures[i][0] ? "Replacement pending" : active ? "Embedded" : editor::language::text("None", "无"));
                    ImGui::SameLine();
                    if (ImGui::SmallButton(remove[i] ? "Keep" : "Remove"))
                    {
                        remove[i]      = !remove[i];
                        textures[i][0] = 0;
                    }
                    ImGui::PopID();
                }
                if (ImGui::Button(editor::language::text("Apply material", "应用材质"), {-1, 29}))
                {
                    auto value    = material;
                    value["name"] = materialName;
                    std::array<std::string, 5> paths;
                    for (size_t i = 0; i < 5; i++)
                        paths[i] = textures[i].data();
                    applyMaterial(value, paths, remove);
                }
            }
            ImGui::EndDisabled();
        }
    };
} // namespace editor
