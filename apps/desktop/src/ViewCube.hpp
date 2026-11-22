#pragma once
#include "Gizmo.hpp"
#include <imgui.h>
namespace editor
{
    struct StandardView
    {
        const char* name;
        const char* shortName;
        double      yaw, pitch;
        int         axis, sign;
    };
    inline const std::array<StandardView, 6> standardViews{
      {{"Front", "F", 0, 0, 2, 1},
       {"Back", "B", 180, 0, 2, -1},
       {"Left", "L", -90, 0, 0, -1},
       {"Right", "R", 90, 0, 0, 1},
       {"Top", "T", 0, 90, 1, 1},
       {"Bottom", "D", 0, -90, 1, -1}}};
    inline bool insideQuad(const std::array<ImVec2, 4>& points, ImVec2 p)
    {
        bool negative = false, positive = false;
        for (int i = 0; i < 4; i++)
        {
            auto  a = points[i], b = points[(i + 1) % 4];
            float cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
            negative |= cross < -.001f;
            positive |= cross > .001f;
        }
        return !(negative && positive);
    }
    inline void drawViewCube(
      Camera camera, ImVec2 pos, ImVec2 area, bool interactive, const std::function<void(double, double, bool)>& orient)
    {
        auto*  draw  = ImGui::GetWindowDrawList();
        auto   f     = cameraFrame(camera);
        auto   mouse = ImGui::GetIO().MousePos;
        ImVec2 origin{pos.x + area.x - 132, pos.y + 10};
        auto   projectCube = [&](V3 p) {
            return ImVec2{origin.x + 60 + float(dot(p, f.right) * 23), origin.y + 52 - float(dot(p, f.up) * 23)};
        };
        const ImU32 fills[]{IM_COL32(42, 44, 48, 255), IM_COL32(71, 74, 80, 255), IM_COL32(54, 57, 63, 255)};
        auto        label = [&](ImVec2 center, const char* text, float font = 11.f) {
            auto size = ImGui::GetFont()->CalcTextSizeA(font, 1000, 0, text);
            draw->AddText(
              ImGui::GetFont(),
              font,
              {center.x - size.x * .5f, center.y - size.y * .5f},
              IM_COL32(232, 233, 236, 255),
              text);
        };
        for (const auto& view : standardViews)
        {
            auto n = times(axis(view.axis), view.sign);
            if (dot(n, sub(f.eye, camera.target)) <= camera.distance * .02)
                continue;
            int                   u = (view.axis + 1) % 3, v = (view.axis + 2) % 3;
            std::array<ImVec2, 4> points;
            const int             signs[4][2]{{-1, -1}, {1, -1}, {1, 1}, {-1, 1}};
            ImVec2                center{};
            for (int i = 0; i < 4; i++)
            {
                auto p    = n;
                p[u]      = signs[i][0];
                p[v]      = signs[i][1];
                points[i] = projectCube(p);
                center.x += points[i].x * .25f;
                center.y += points[i].y * .25f;
            }
            bool hot = interactive && insideQuad(points, mouse);
            draw->AddConvexPolyFilled(points.data(), 4, hot ? IM_COL32(57, 90, 118, 255) : fills[view.axis]);
            draw->AddPolyline(points.data(), 4, hot ? IM_COL32(123, 182, 238, 255) : IM_COL32(102, 106, 114, 255), ImDrawFlags_Closed, 1);
            label(center, view.name, 10);
            if (hot)
            {
                ImGui::SetMouseCursor(ImGuiMouseCursor_Hand);
                if (ImGui::IsMouseClicked(0))
                    orient(view.yaw, view.pitch, true);
            }
        }
        // Always-visible orientation tripod; these are world axes, independent of selection.
        ImVec2      center{pos.x + 45, pos.y + area.y - 44};
        const ImU32 colors[]{IM_COL32(190, 65, 77, 255), IM_COL32(43, 139, 72, 255), IM_COL32(53, 104, 200, 255)};
        for (int k = 0; k < 3; k++)
        {
            auto   a = axis(k);
            ImVec2 end{center.x + float(dot(a, f.right) * 27), center.y - float(dot(a, f.up) * 27)};
            draw->AddLine(center, end, colors[k], 2);
            char text[2]{char('X' + k), 0};
            draw->AddText({end.x + 3, end.y - 6}, colors[k], text);
        }
        draw->AddCircleFilled(center, 3, IM_COL32(110, 122, 139, 255));
    }
} // namespace editor
