#pragma once
#include "Gizmo.hpp"
#include "Hierarchy.hpp"
#include "Navigation.hpp"
#include "Placement.hpp"
#include "RenderBridge.hpp"
#include "SceneObjects.hpp"
#include "SelectionTransform.hpp"
#include "ViewCube.hpp"
#include "Theme.hpp"
#include <imgui.h>
#include <render/Window.hpp>
namespace editor
{
    inline SurfaceQuery sceneSurfaceQuery(editor::RenderWindow& window, const Json& scene)
    {
        return surfaceQuery(
          scene,
          [&window](Ray ray, const std::set<std::string>& included, const std::set<std::string>& excluded)
            -> std::optional<SurfaceHit> {
              render::Ray request;
              for (int k = 0; k < 3; k++)
              {
                  request.origin[k]    = float(ray.origin[k]);
                  request.direction[k] = float(ray.direction[k]);
              }
              request.includeIds.assign(included.begin(), included.end());
              request.excludeIds.assign(excluded.begin(), excluded.end());
              auto hit = window.PickScene(request);
              if (!hit)
                  return {};
              return SurfaceHit{hit->id, {hit->position[0], hit->position[1], hit->position[2]}};
          });
    }
    struct ViewportTools
    {
        Tool                          mode     = Tool::Translate;
        bool                          panTool  = false, selectOnly = false;
        bool                          gridSnap = true, placementCancelled = false;
        bool                          moveSnap = false;
        std::string                   lightAimId;
        std::string                   hoveredId;
        double                        nextHoverPick = 0.;
        inline static constexpr double gridSteps[]{.1, .25, .5, 1, 2, 5};
        int                           gridIndex = 3;
        std::optional<Drag>           drag;
        Json                          dragBase;
        TransformSpace                space = TransformSpace::Local;
        std::optional<SelectionFrame> dragFrame;
        std::vector<std::string>      dragIDs;
        TransformSpace                dragSpace = TransformSpace::Local;
        bool                          orbit = false, pan = false;
        int                           gestureButton = ImGuiMouseButton_Right;
        ImVec2                        origin{};
        Screen                        orbitStart;
        editor::OrbitCamera           orbitCamera;
        ImVec2                        screen(Screen p) const { return {origin.x + float(p.x), origin.y + float(p.y)}; }
        void                          cancel(History& h)
        {
            if (drag)
                h.cancelPreview();
            drag.reset();
            dragFrame.reset();
        }
        void draw(
          History&                                                    h,
          bool                                                        readOnly,
          const std::string&                                          selected,
          const std::vector<std::string>&                             selections,
          editor::RenderWindow&                                       window,
          ImVec2                                                      pos,
          ImVec2                                                      area,
          Size                                                        full,
          const AssetBounds&                                          bounds,
          const std::function<void(const std::string&, const Json&)>& place,
          const std::function<void(bool)>&                            frame,
          const std::function<void(const std::string&, bool)>&        select,
          const std::function<void(const std::string&)>&              error,
          const std::function<void(editor::OrbitCamera)>&             cameraChange)
        {
            if (readOnly)
            {
                cancel(h);
                lightAimId.clear();
                orbit = false;
                return;
            }
            origin = pos;
            ImGui::SetNextWindowPos(pos);
            ImGui::SetNextWindowSize(area);
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {0, 0});
            ImGui::Begin(
              "##SceneViewport",
              nullptr,
              ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoMove
                | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoScrollbar
                | ImGuiWindowFlags_NoBringToFrontOnFocus);
            auto&  io     = ImGui::GetIO();
            auto   camera = window.GetCamera();
            Camera c      = navigationCamera(camera);
            drawViewCube(
              c,
              pos,
              area,
              !drag && !orbit && ImGui::IsWindowHovered(),
              [&](double yaw, double pitch, bool orthographic) {
                  auto next         = camera;
                  next.yaw          = float(yaw);
                  next.pitch        = float(pitch);
                  next.orthographic = orthographic;
                  cameraChange(next);
              });
            bool cubeHovered = io.MousePos.x >= pos.x + area.x - 136 && io.MousePos.x <= pos.x + area.x - 8
                               && io.MousePos.y >= pos.y + 8 && io.MousePos.y <= pos.y + 94;
            using theme::Icon;
            ImGui::SetCursorScreenPos({pos.x + 12, pos.y + 10});
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, {3, 4});
            ImGui::GetWindowDrawList()->AddRectFilled({pos.x + 8, pos.y + 6},
                {pos.x + 207, pos.y + 40}, IM_COL32(32, 33, 36, 255), 5);
            ImGui::BeginDisabled(drag.has_value());
            if (theme::iconButton("##Select", Icon::Pointer, selectOnly))
            {
                selectOnly = true;
                panTool = false;
            }
            ImGui::SetItemTooltip("%s", editor::language::text("Select", "选择"));
            for (const auto& entry : std::array{
                std::tuple{Tool::Translate, Icon::Move, "Move (W)"},
                std::tuple{Tool::Rotate, Icon::Rotate, "Rotate (E)"},
                std::tuple{Tool::Scale, Icon::Scale, "Scale (R)"}})
            {
                const auto [tool, glyph, label] = entry;
                ImGui::SameLine();
                ImGui::PushID(label);
                if (theme::iconButton("##Tool", glyph, !selectOnly && !panTool && mode == tool))
                {
                    mode = tool;
                    selectOnly = false;
                    panTool = false;
                }
                ImGui::SetItemTooltip("%s", label);
                ImGui::PopID();
            }
            ImGui::SameLine();
            if (ImGui::Button(space == TransformSpace::Local ? editor::language::text("Local", "局部") : editor::language::text("World", "世界"), {60, 26}))
                space = space == TransformSpace::Local ? TransformSpace::World : TransformSpace::Local;
            ImGui::SetItemTooltip("%s", editor::language::text("Coordinate space (X)", "切换坐标系 (X)"));
            ImGui::EndDisabled();
            ImGui::PopStyleVar();
            bool canAim = false;
            if (selections.size() == 1 && !inheritedFlag(h.scene, selected, "locked"))
                for (const auto& node : h.scene["nodes"])
                    if (node["id"] == selected && node.contains("light") && node["light"]["type"] != "point")
                        canAim = true;
            if (!canAim || lightAimId != selected || ImGui::IsKeyPressed(ImGuiKey_Escape))
                lightAimId.clear();
            bool aimHovered = false;
            if (canAim)
            {
                ImGui::SetCursorScreenPos({pos.x + 12, pos.y + 45});
                ImGui::BeginDisabled(drag.has_value());
                if (theme::tool(editor::language::text("Aim light", "瞄准灯光"), !lightAimId.empty()))
                    lightAimId = lightAimId.empty() ? selected : "";
                aimHovered = ImGui::IsItemHovered();
                ImGui::SetItemTooltip("%s", editor::language::text("Click a model or the ground to aim. Esc cancels.", "点击模型或地面瞄准灯光。Esc 取消。"));
                ImGui::EndDisabled();
            }
            const bool toolbarHovered = aimHovered || (io.MousePos.x >= pos.x + 8 && io.MousePos.x <= pos.x + 243
                                        && io.MousePos.y >= pos.y + 6 && io.MousePos.y <= pos.y + 40);
            ImGui::SetCursorScreenPos(pos);
            ImGui::InvisibleButton(
              "##SceneInput",
              {std::max(1.f, area.x - 2), std::max(1.f, area.y - 2)},
              ImGuiButtonFlags_MouseButtonLeft | ImGuiButtonFlags_MouseButtonRight
                | ImGuiButtonFlags_MouseButtonMiddle);
            bool        hovered       = ImGui::IsItemHovered() && !cubeHovered && !toolbarHovered;
            const auto* activePayload = ImGui::GetDragDropPayload();
            const bool  assetDragging = activePayload && activePayload->IsDataType("NOVA_ASSET");
            if (assetDragging && (io.AppFocusLost || ImGui::IsKeyPressed(ImGuiKey_Escape)))
                placementCancelled = true;
            if (assetDragging && !cubeHovered && !toolbarHovered && ImGui::BeginDragDropTarget())
            {
                const auto* payload = ImGui::AcceptDragDropPayload(
                  "NOVA_ASSET", ImGuiDragDropFlags_AcceptBeforeDelivery | ImGuiDragDropFlags_AcceptNoDrawDefaultRect);
                if (
                  payload && payload->DataSize > 0
                  && static_cast<const char*>(payload->Data)[payload->DataSize - 1] == '\0' && !placementCancelled)
                {
                    std::string asset(static_cast<const char*>(payload->Data));
                    auto        b = bounds.find(asset);
                    if (h.scene["assets"].contains(asset) && b != bounds.end())
                    {
                        auto         t = placementAt(
                          {io.MousePos.x - pos.x, io.MousePos.y - pos.y},
                          c,
                          full,
                          b->second,
                          gridSnap != io.KeyShift,
                          gridSteps[gridIndex],
                          &h.scene,
                          &bounds,
                          sceneSurfaceQuery(window, h.scene));
                        auto*      painter = ImGui::GetWindowDrawList();
                        const auto color   = IM_COL32(165, 225, 190, 255);
                        if (t)
                        {
                            auto                                 matrix = localMatrix(*t);
                            auto                                 points = boundsCorners(b->second);
                            std::array<std::optional<Screen>, 8> projected;
                            for (int i = 0; i < 8; i++)
                                projected[i] = project(point(matrix, points[i]), c, full);
                            const int footIndices[]{0, 1, 5, 4};
                            ImVec2    footprint[4];
                            bool      visible = true;
                            for (int i = 0; i < 4; i++)
                            {
                                visible &= projected[footIndices[i]].has_value();
                                if (projected[footIndices[i]])
                                    footprint[i] = screen(*projected[footIndices[i]]);
                            }
                            if (visible)
                            {
                                painter->AddConvexPolyFilled(footprint, 4, IM_COL32(165, 225, 190, 28));
                                painter->AddPolyline(footprint, 4, color, ImDrawFlags_Closed, 2);
                            }
                            for (int i = 0; i < 8; i++)
                                for (int k = 0; k < 3; k++)
                                    if (!(i & (1 << k)) && projected[i] && projected[i | (1 << k)])
                                        painter->AddLine(
                                          screen(*projected[i]), screen(*projected[i | (1 << k)]), color, 2);
                            char hint[256];
                            std::snprintf(
                              hint,
                              sizeof(hint),
                              "Drop to create: %.2f, %.2f, %.2f | %s | Esc cancels",
                              (*t)["position"][0].get<double>(),
                              (*t)["position"][1].get<double>(),
                              (*t)["position"][2].get<double>(),
                              gridSnap != io.KeyShift ? "Grid snap" : "Free placement");
                            painter->AddText({pos.x + 12, pos.y + area.y - 32}, color, hint);
                            if (payload->IsDelivery())
                                place(asset, *t);
                        }
                        else
                            painter->AddText(
                              {pos.x + 12, pos.y + 50},
                              IM_COL32(245, 160, 155, 255),
                              "No model or ground intersection. Adjust the view.");
                    }
                }
                ImGui::EndDragDropTarget();
            }
            if (assetDragging)
                hovered = false;
            Screen mouse{io.MousePos.x - pos.x, io.MousePos.y - pos.y};
            if (drag && (!h.previewBase || drag->gizmo.id != selected || dragIDs != selections || dragSpace != space || drag->gizmo.size.width!=full.width || drag->gizmo.size.height!=full.height))
            {
                cancel(h);
            }
            if (io.AppFocusLost || !ImGui::IsMousePosValid())
            {
                cancel(h);
                orbit = false;
            }
            if (ImGui::IsKeyPressed(ImGuiKey_Escape))
            {
                cancel(h);
                orbit = false;
            }
            if (!io.WantTextInput && (io.KeyCtrl || io.KeySuper) && ImGui::IsKeyPressed(ImGuiKey_Z))
            {
                if (assetDragging)
                    placementCancelled = true;
                else if (drag)
                    cancel(h);
                else if (io.KeyShift)
                    h.redo();
                else
                    h.undo();
                bool exists = selected.empty();
                for (const auto& n : h.scene["nodes"])
                    if (n["id"] == selected)
                        exists = true;
                if (!exists)
                    select("", false);
            }
            if (!io.WantTextInput && !io.KeyCtrl && !io.KeySuper && !assetDragging && ImGui::IsKeyPressed(ImGuiKey_X))
            {
                cancel(h);
                space = space == TransformSpace::Local ? TransformSpace::World : TransformSpace::Local;
            }
            if (!io.WantTextInput && !drag && !assetDragging)
            {
                if (!io.KeyCtrl && !io.KeySuper)
                {
                    if (!orbit && (ImGui::IsKeyPressed(ImGuiKey_F) || ImGui::IsKeyPressed(ImGuiKey_Home)))
                        frame(io.KeyShift || ImGui::IsKeyPressed(ImGuiKey_Home));
                    if (!orbit && ImGui::IsKeyPressed(ImGuiKey_P))
                    {
                        auto next         = camera;
                        next.orthographic = !camera.orthographic;
                        cameraChange(next);
                    }
                    if (ImGui::IsKeyPressed(ImGuiKey_H))
                        panTool = true;
                    if (ImGui::IsKeyPressed(ImGuiKey_W))
                    {
                        mode    = Tool::Translate;
                        panTool = false;
                        selectOnly = false;
                    }
                    if (ImGui::IsKeyPressed(ImGuiKey_E))
                    {
                        mode    = Tool::Rotate;
                        panTool = false;
                        selectOnly = false;
                    }
                    if (ImGui::IsKeyPressed(ImGuiKey_R))
                    {
                        mode    = Tool::Scale;
                        panTool = false;
                        selectOnly = false;
                    }
                }
            }
            auto selectionGeometry = selectOnly ? std::nullopt : selectionGizmo(h.scene, selections, selected, space, mode, c, full, bounds);
            std::optional<Gizmo> g = selectionGeometry ? std::optional<Gizmo>(selectionGeometry->gizmo) : std::nullopt;
            if (
              hovered && !drag && !orbit
              && (ImGui::IsMouseClicked(ImGuiMouseButton_Middle) || ImGui::IsMouseClicked(ImGuiMouseButton_Right) || ((io.KeyAlt || panTool) && ImGui::IsMouseClicked(ImGuiMouseButton_Left))))
            {
                pan = panTool || ImGui::IsMouseClicked(ImGuiMouseButton_Middle)
                      || (io.KeyShift && ImGui::IsMouseClicked(ImGuiMouseButton_Right));
                gestureButton = ImGui::IsMouseClicked(ImGuiMouseButton_Middle)  ? ImGuiMouseButton_Middle
                                : ImGui::IsMouseClicked(ImGuiMouseButton_Right) ? ImGuiMouseButton_Right
                                                                                : ImGuiMouseButton_Left;
                orbit         = true;
                orbitStart    = mouse;
                orbitCamera   = camera;
            }
            if (orbit)
            {
                if (!ImGui::IsMouseDown(gestureButton))
                    orbit = false;
                else
                {
                    auto next  = orbitCamera;
                    next.yaw   = float(orbitCamera.yaw - (mouse.x - orbitStart.x) * .35);
                    next.yaw   = std::remainder(next.yaw, 360.f);
                    next.pitch = std::clamp(float(orbitCamera.pitch + (mouse.y - orbitStart.y) * .35), -90.f, 90.f);
                    if (pan)
                    {
                        Camera base = navigationCamera(orbitCamera);
                        auto   p    = panCamera(base, mouse.x - orbitStart.x, mouse.y - orbitStart.y, full);
                        next        = orbitCamera;
                        for (int k = 0; k < 3; k++)
                            next.target[k] = float(p.target[k]);
                    }
                    cameraChange(next);
                }
            }
            auto targetAt = [&]() -> std::string {
                auto        ray = rayAt(mouse, c, full);
                render::Ray request;
                for (int i = 0; i < 3; ++i)
                {
                    request.origin[i]    = float(ray.origin[i]);
                    request.direction[i] = float(ray.direction[i]);
                }
                for (const auto& n : h.scene["nodes"])
                {
                    auto id = n["id"].get<std::string>();
                    if (
                      n.contains("assetId") && !inheritedFlag(h.scene, id, "locked")
                      && !inheritedFlag(h.scene, id, "hidden"))
                        request.includeIds.push_back(id);
                }
                auto hit =
                  request.includeIds.empty() ? std::optional<render::SceneHit>{} : window.PickScene(request);
                bool visible =
                  hit && project({hit->position[0], hit->position[1], hit->position[2]}, c, full).has_value();
                bool userNode = false;
                if (visible)
                    for (const auto& n : h.scene["nodes"])
                        if (n["id"] == hit->id)
                            userNode = true;
                std::string helper;
                double      nearest = 18;
                for (const auto& glyph : sceneGlyphs(h.scene, full.width / full.height))
                    if (!inheritedFlag(h.scene, glyph.id, "locked"))
                    {
                        auto p = project(glyph.position, c, full);
                        if (p)
                        {
                            double d = screenLength(*p, mouse);
                            if (d < nearest)
                            {
                                nearest = d;
                                helper  = glyph.id;
                            }
                        }
                    }
                return !helper.empty() ? helper : visible && userNode ? hit->id : std::string{};
            };
            const auto handle = g ? hitGizmo(*g, mouse) : std::optional<int>{};
            const bool click = hovered && !orbit && !drag && !io.KeyAlt && ImGui::IsMouseClicked(ImGuiMouseButton_Left);
            if (hovered && !lightAimId.empty()) ImGui::SetMouseCursor(ImGuiMouseCursor_Hand);
            if (click && !lightAimId.empty())
            {
                const auto ray = rayAt(mouse, c, full);
                const auto hit = sceneSurfaceQuery(window, h.scene)(ray, {});
                const auto t = std::abs(ray.direction[1]) > 1e-6 ? -ray.origin[1] / ray.direction[1] : -1.;
                if (hit || t > 0)
                {
                    try
                    {
                        auto next = h.scene;
                        aimLightAt(next, lightAimId, hit ? hit->position : add(ray.origin, times(ray.direction, t)));
                        h.commit(std::move(next));
                        lightAimId.clear();
                    }
                    catch (const std::exception& e) { error(e.what()); }
                }
                else error("Click a model or the ground to aim");
            }
            else if (click)
            {
                if (handle)
                {
                    auto next = beginDrag(*g, *handle, mouse);
                    if (next)
                    {
                        drag      = next;
                        dragBase  = h.scene;
                        dragFrame = selectionGeometry->frame;
                        dragIDs   = selections;
                        dragSpace = space;
                        h.beginPreview();
                    }
                }
                else
                {
                    select(targetAt(), io.KeyCtrl || io.KeySuper || io.KeyShift);
                }
            }
            if (drag)
            {
                if (ImGui::IsMouseDown(ImGuiMouseButton_Left))
                {
                    try
                    {
                        auto next  = dragBase;
                        auto edits = selectionEdits(dragBase, *dragFrame, updateDrag(*drag, mouse, drag->gizmo.mode == Tool::Translate ? moveSnap != io.KeyShift : io.KeyShift,
                                           gridSteps[gridIndex], space == TransformSpace::World));
                        applySelectionEdits(next, edits);
                        h.preview(next);
                    }
                    catch (const std::exception& e)
                    {
                        cancel(h);
                        error(e.what());
                    }
                }
                else
                {
                    h.finishPreview();
                    drag.reset();
                    dragFrame.reset();
                }
            }
            if (hovered && !drag && !orbit && io.MouseWheel != 0)
            {
                auto next     = camera;
                next.distance = std::clamp(float(camera.distance * std::exp(-io.MouseWheel * .12)), .05f, 100.f);
                cameraChange(next);
            }
            const bool canHover = hovered && !drag && !orbit && !handle && !panTool && !assetDragging
                                  && !io.KeyAlt && lightAimId.empty() && !ImGui::IsMouseDown(ImGuiMouseButton_Left);
            if (!canHover)
            {
                hoveredId.clear();
                nextHoverPick = 0.;
            }
            else if (io.MouseDelta.x || io.MouseDelta.y || ImGui::GetTime() >= nextHoverPick)
            {
                hoveredId = targetAt();
                nextHoverPick = ImGui::GetTime() + ((io.MouseDelta.x || io.MouseDelta.y) ? 1. / 60. : .15);
            }
            auto* painter = ImGui::GetWindowDrawList();
            for (const auto& glyph : sceneGlyphs(h.scene, full.width / full.height))
            {
                bool chosen = std::find(selections.begin(), selections.end(), glyph.id) != selections.end();
                auto color  = chosen         ? IM_COL32(240, 197, 90, 255)
                              : glyph.id == hoveredId ? IM_COL32(133, 234, 255, 255)
                              : glyph.camera ? IM_COL32(158, 213, 255, 255)
                                             : IM_COL32(255, 207, 88, 255);
                const bool showRange = chosen || (glyph.id == hoveredId &&
                  (glyph.lightType == "spot" || glyph.lightType == "point"));
                if (showRange) for (const auto& [a, b] : glyph.lines)
                {
                    auto pa = project(a, c, full), pb = project(b, c, full);
                    if (pa && pb)
                        painter->AddLine(screen(*pa), screen(*pb),
                          color, chosen ? 2.5f : 1.8f);
                }
                auto p = project(glyph.position, c, full);
                if (p)
                {
                    const auto center = screen(*p);
                    {
                        const auto at = [&](float x, float y) { return ImVec2{center.x + x * 1.65f, center.y + y * 1.65f}; };
                        const auto stroke = [&](std::initializer_list<ImVec2> points, bool closed = false) {
                            painter->AddPolyline(points.begin(), static_cast<int>(points.size()), color,
                              closed ? ImDrawFlags_Closed : ImDrawFlags_None, 2.5f);
                        };
                        if (glyph.camera)
                        {
                            painter->AddRect(at(-8, -5), at(3, 5), color, 0.f, ImDrawFlags_None, 2.5f);
                            stroke({at(3,-2), at(8,-5), at(8,5), at(3,2)});
                        }
                        else if (glyph.lightType == "spot")
                        {
                            stroke({at(-6,-5), at(0,-5), at(5,-8), at(5,5), at(0,2), at(-6,2)}, true);
                            stroke({at(2,7), at(5,9)});
                            stroke({at(7,0), at(9,0)});
                        }
                        else if (glyph.lightType == "rectangle")
                        {
                            painter->AddRect(at(-7,-5), at(7,5), color, 0.f, ImDrawFlags_None, 2.f);
                            painter->AddRect(at(-4,-2), at(4,2), color, 0.f, ImDrawFlags_None, 2.f);
                        }
                        else if (glyph.lightType == "point")
                        {
                            stroke({at(-3,3), at(-5,0), at(-5,-3), at(-3,-6), at(0,-7), at(3,-6),
                              at(5,-3), at(5,0), at(3,3), at(3,7), at(-3,7)}, true);
                            stroke({at(-2,9), at(2,9)});
                        }
                        else
                        {
                            painter->AddCircle(center, 5.8f, color, 16, 2.5f);
                            for (int i = 0; i < 8; ++i)
                            {
                                const float angle = i * .78539816f;
                                const float x = std::cos(angle), y = std::sin(angle);
                                stroke({at(6*x,6*y), at(8*x,8*y)});
                            }
                        }
                    }
                    if (chosen || glyph.camera)
                    {
                        const auto label = glyph.camera && glyph.active ? glyph.name + " · Main" : glyph.name;
                        painter->AddText({center.x + 20, center.y - 11}, IM_COL32(28, 32, 37, 255), label.c_str());
                        painter->AddText({center.x + 19, center.y - 12}, color, label.c_str());
                    }
                }
            }
            selectionGeometry = selectOnly ? std::nullopt : selectionGizmo(h.scene, selections, selected, space, mode, c, full, bounds);
            g                 = selectionGeometry ? std::optional<Gizmo>(selectionGeometry->gizmo) : std::nullopt;
            if (g)
            {
                auto        hot = hovered ? hitGizmo(*g, mouse) : std::optional<int>{};
                const ImU32 colors[]{
                  IM_COL32(241, 99, 105, 255), IM_COL32(123, 218, 147, 255), IM_COL32(104, 168, 255, 255)};
                for (const auto& line : g->lines)
                {
                    const bool active = (drag && drag->axis == line.axis) || (!drag && hot && *hot == line.axis);
                    auto       color  = active ? IM_COL32(255, 225, 117, 255) : colors[line.axis];
                    for (size_t i = 1; i < line.points.size(); ++i)
                        painter->AddLine(
                          screen(line.points[i - 1]), screen(line.points[i]), IM_COL32(15, 18, 23, 220), 6.f);
                    for (size_t i = 1; i < line.points.size(); ++i)
                        painter->AddLine(
                          screen(line.points[i - 1]), screen(line.points[i]), color, active ? 3.5f : 2.5f);
                    if (line.points.size() > 1 && mode != Tool::Rotate)
                    {
                        auto a = line.points[0], b = line.points.back();
                        if (screenLength(a, b) > 18)
                        {
                            if (mode == Tool::Scale)
                                painter->AddRectFilled(
                                  {origin.x + float(b.x - 5), origin.y + float(b.y - 5)},
                                  {origin.x + float(b.x + 5), origin.y + float(b.y + 5)},
                                  color);
                            else
                            {
                                double length = screenLength(a, b), dx = (b.x - a.x) / length,
                                       dy = (b.y - a.y) / length;
                                painter->AddTriangleFilled(
                                  screen(b),
                                  {origin.x + float(b.x - 12 * dx - 5 * dy), origin.y + float(b.y - 12 * dy + 5 * dx)},
                                  {origin.x + float(b.x - 12 * dx + 5 * dy), origin.y + float(b.y - 12 * dy - 5 * dx)},
                                  color);
                            }
                        }
                    }
                    if (!line.points.empty())
                    {
                        auto p = line.points.back();
                        char label[2]{char('X' + line.axis), 0};
                        painter->AddText({origin.x + float(p.x + 7), origin.y + float(p.y - 14)}, color, label);
                    }
                }
                if (mode != Tool::Rotate)
                {
                    auto p = g->pivot;
                    auto color =
                      (drag && drag->axis == -1) ? IM_COL32(255, 225, 117, 255) : IM_COL32(233, 238, 246, 255);
                    if (mode == Tool::Scale)
                        painter->AddRectFilled(
                          {origin.x + float(p.x - 5), origin.y + float(p.y - 5)},
                          {origin.x + float(p.x + 5), origin.y + float(p.y + 5)},
                          color);
                    else
                        painter->AddCircleFilled(screen(p), 5, color);
                }
                if (hot || drag)
                    ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeAll);
            }
            if (panTool && hovered)
                ImGui::SetMouseCursor(ImGuiMouseCursor_Hand);
            ImGui::End();
            ImGui::PopStyleVar();
        }
    };
} // namespace editor
