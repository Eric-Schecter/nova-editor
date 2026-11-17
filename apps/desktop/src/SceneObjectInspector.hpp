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
        std::array<float, 3> angles{};
        void                 draw(
                          const Json&                                              node,
                          bool                                                     viewing,
                          const std::string&                                       notice,
                          const std::function<void(Json, double, double, double)>& apply,
                          const std::function<void(bool)>&                         primary,
                          const std::function<void()>&                             capture,
                          const std::function<void()>&                             preview)
        {
            if (key != node.dump())
            {
                key    = node.dump();
                draft  = node.contains("camera") ? node["camera"] : node["light"];
                angles = localAim(node);
                if (node.contains("camera"))
                {
                    draft["verticalFov"] = draft.value("verticalFov", 45.);
                    draft["nearPlane"]   = draft.value("nearPlane", .01);
                    draft["farPlane"]    = draft.value("farPlane", 200.);
                }
            }
            bool camera = node.contains("camera");
            if (!camera)
            {
                draft["range"]          = draft.value("range", 10.);
                draft["innerConeAngle"] = draft.value("innerConeAngle", .35);
                draft["outerConeAngle"] = draft.value("outerConeAngle", .6);
            }
            ImGui::Separator();
            ImGui::TextUnformatted(camera ? "Scene camera" : "Scene light");
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
                number("Vertical FOV (degrees)", "verticalFov");
                number("Near clipping plane", "nearPlane");
                number("Far clipping plane", "farPlane");
                ImGui::TextDisabled("Local roll (degrees)");
                ImGui::SetNextItemWidth(-1);
                ImGui::InputFloat("##CameraRoll", &angles[2], 1, 10, "%.3f");
            }
            else
            {
                int         type = draft["type"] == "point" ? 1 : draft["type"] == "spot" ? 2 : 0;
                const char* types[]{"Directional", "Point", "Spot"};
                if (ImGui::Combo("Light type", &type, types, 3))
                {
                    draft["type"] = type == 1 ? "point" : type == 2 ? "spot" : "directional";
                    if (type)
                        draft["shadows"] = false;
                }
                if (type)
                    number("Range (0 = unlimited)", "range");
                if (type == 2)
                    for (const char* field : {"innerConeAngle", "outerConeAngle"})
                    {
                        float degrees = draft[field].get<float>() * 180.f / 3.141592653589793f;
                        if (ImGui::InputFloat(
                              field == std::string("innerConeAngle") ? "Inner half angle (degrees)"
                                                                     : "Outer half angle (degrees)",
                              &degrees,
                              1,
                              5))
                            draft[field] = degrees * 3.141592653589793 / 180;
                    }
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
                ImGui::BeginDisabled(type != 0);
                if (ImGui::Checkbox("Node shadows", &shadows))
                    draft["shadows"] = shadows;
                number("Shadow softness", "softness");
                ImGui::EndDisabled();
                ImGui::TextWrapped("Up to 16 simultaneous lights. Point/spot shadows are unsupported.");
            }
            if (ImGui::Button("Apply node settings", {-1, 29}))
                apply(draft, angles[0], angles[1], angles[2]);
            bool active = camera ? node["camera"]["primary"].get<bool>() : node["light"]["active"].get<bool>();
            if (ImGui::Button(
                  camera ? (active ? "Unset main camera" : "Set main camera")
                         : (active ? "Disable light" : "Enable light"),
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
