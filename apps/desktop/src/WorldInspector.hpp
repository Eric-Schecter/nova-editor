#pragma once
#include "WorldAssets.hpp"
#include <imgui.h>
namespace editor
{
    struct WorldInspector
    {
        Json        draft;
        std::string key;
        char        path[1024]{};
        char        background[8]{}, fog[8]{};
        template <class Apply, class Import>
        void draw(const Json& scene, const std::filesystem::path& presets, Apply apply, Import import)
        {
            auto value = scene.value("world", defaultWorld());
            auto next  = value.dump();
            if (next != key)
            {
                key   = next;
                draft = value;
                std::snprintf(background, 8, "%s", draft["background"]["color"].get<std::string>().c_str());
                std::snprintf(fog, 8, "%s", draft["fog"]["color"].get<std::string>().c_str());
            }
            ImGui::TextUnformatted("Scene environment");
            ImGui::Separator();
            ImGui::TextWrapped(
              "%s",
              draft["environment"]["map"].is_null() ? "Default studio (no map)"
                                                    : draft["environment"]["name"].get<std::string>().c_str());
            if (ImGui::Button("Studio map"))
                import(presets / "studio_small_09.nenv");
            ImGui::SameLine();
            if (ImGui::Button("Sunset map"))
                import(presets / "venice_sunset.nenv");
            ImGui::SetNextItemWidth(-1);
            ImGui::InputTextWithHint("##EnvironmentPath", "Path to .nenv", path, sizeof(path));
            if (ImGui::Button("Import .nenv"))
                import(std::filesystem::path(path));
            if (!draft["environment"]["map"].is_null() && ImGui::Button("Remove map"))
            {
                draft["environment"]["map"]  = nullptr;
                draft["environment"]["name"] = "";
                draft["background"]["mode"]  = "color";
            }
            auto number = [&](const char* label, Json& obj, const char* field, float step) {
                float v = obj[field];
                ImGui::SetNextItemWidth(-1);
                ImGui::TextUnformatted(label);
                if (ImGui::InputFloat((std::string("##") + label).c_str(), &v, step, step * 10))
                    obj[field] = v;
            };
            ImGui::BeginDisabled(draft["environment"]["map"].is_null());
            number("Environment rotation", draft["environment"], "rotation", 1);
            number("Environment intensity", draft["environment"], "intensity", .1f);
            number("Background intensity", draft["environment"], "backgroundIntensity", .1f);
            ImGui::EndDisabled();
            ImGui::SeparatorText("Background");
            int         mode = draft["background"]["mode"] == "environment" ? 1 : 0;
            const char* bg[]{"Color", "Environment"};
            if (ImGui::Combo("Background type", &mode, bg, 2))
                draft["background"]["mode"] = mode ? "environment" : "color";
            ImGui::InputText("Color ##Background", background, 8);
            ImGui::SeparatorText("Fog");
            int         type = draft["fog"]["mode"] == "none" ? 0 : draft["fog"]["mode"] == "linear" ? 1 : 2;
            const char* modes[]{"Off", "Linear", "Exponential squared"};
            if (ImGui::Combo("Fog type", &type, modes, 3))
                draft["fog"]["mode"] = type == 0 ? "none" : type == 1 ? "linear" : "exp2";
            ImGui::InputText("Color ##Fog", fog, 8);
            if (type == 1)
            {
                number("Fog near", draft["fog"], "near", 1);
                number("Fog far", draft["fog"], "far", 1);
            }
            if (type == 2)
                number("Fog density", draft["fog"], "density", .005f);
            if (ImGui::Button("Apply environment"))
            {
                draft["background"]["color"] = std::string(background);
                draft["fog"]["color"]        = std::string(fog);
                apply(draft);
            }
            ImGui::TextWrapped("Saved with project. Fog affects models and ground; sky stays clear.");
        }
    };
} // namespace editor
