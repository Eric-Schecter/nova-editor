#pragma once
#include "Assets.hpp"
#include "SceneObjects.hpp"
#include <imgui.h>
namespace editor
{
    struct SceneObjectInspector
    {
        std::string          key;
        Json                 draft;
        std::array<float, 2> angles{};
        void                 draw(
                          const Json&                                      node,
                          bool                                             viewing,
                          const std::string&                               notice,
                          const std::function<void(Json, double, double)>& apply,
                          const std::function<void(bool)>&                 primary,
                          const std::function<void()>&                     capture,
                          const std::function<void()>&                     preview)
        {
            if (key != node.dump())
            {
                key    = node.dump();
                draft  = node.contains("camera") ? node["camera"] : node["light"];
                angles = localAim(node);
            }
            bool camera = node.contains("camera");
            ImGui::Separator();
            ImGui::TextUnformatted(camera ? "Scene camera" : "Directional light");
            ImGui::TextDisabled("Local yaw / pitch (degrees)");
            ImGui::SetNextItemWidth(-1);
            ImGui::InputFloat2("##ObjectAim", angles.data());
            auto number = [&](const char* label, const char* field) {
                float value = draft[field];
                ImGui::TextDisabled("%s", label);
                ImGui::SetNextItemWidth(-1);
                if (ImGui::InputFloat((std::string("##Node") + field).c_str(), &value, .1, 1, "%.3f"))
                    draft[field] = value;
            };
            if (camera)
            {
                int         projection = draft["projection"] == "orthographic" ? 1 : 0;
                const char* choices[]{"Perspective", "Orthographic"};
                ImGui::SetNextItemWidth(-1);
                if (ImGui::Combo("##CameraProjection", &projection, choices, 2))
                    draft["projection"] = projection ? "orthographic" : "perspective";
                if (projection)
                    number("Orthographic height", "orthographicSize");
                else
                    number("Target distance", "focusDistance");
                number("Exposure", "exposure");
                ImGui::TextWrapped("Fixed 45 deg FOV / no roll / clip 0.01 - 200");
            }
            else
            {
                float color[3];
                for (int k = 0; k < 3; k++)
                    color[k] = assets::linearToSRGB(draft["color"][k]);
                ImGui::TextDisabled("Color");
                ImGui::SetNextItemWidth(-1);
                if (ImGui::ColorEdit3("##NodeLightColor", color, ImGuiColorEditFlags_DisplayHex))
                    for (int k = 0; k < 3; k++)
                        draft["color"][k] = assets::srgbToLinear(color[k]);
                number("Intensity", "intensity");
                bool shadows = draft["shadows"];
                if (ImGui::Checkbox("Node shadows", &shadows))
                    draft["shadows"] = shadows;
                number("Shadow softness", "softness");
                ImGui::TextWrapped("One active directional light. Studio environment fill remains.");
            }
            if (ImGui::Button("Apply node settings", {-1, 29}))
                apply(draft, angles[0], angles[1]);
            bool active = camera ? node["camera"]["primary"].get<bool>() : node["light"]["active"].get<bool>();
            if (ImGui::Button(
                  camera ? (active ? "Unset main camera" : "Set main camera")
                         : (active ? "Use default studio" : "Use as scene light"),
                  {-1, 29}))
                primary(!active);
            if (camera)
            {
                ImGui::BeginDisabled(viewing);
                if (ImGui::Button("Capture editor view", {-1, 29}))
                    capture();
                ImGui::EndDisabled();
                ImGui::BeginDisabled(!active);
                if (ImGui::Button(viewing ? "Return to editor view" : "Preview main camera", {-1, 29}))
                    preview();
                ImGui::EndDisabled();
                if (!notice.empty())
                    ImGui::TextWrapped("%s", notice.c_str());
            }
            ImGui::Separator();
        }
    };
} // namespace editor
