#pragma once
#include "Language.hpp"
#include <algorithm>
#include <filesystem>
#include <imgui.h>
namespace editor::theme
{
    inline ImFont* bold = nullptr;
    inline ImVec4  color(unsigned int value, float alpha = 1)
    {
        return {float((value >> 16) & 255) / 255, float((value >> 8) & 255) / 255, float(value & 255) / 255, alpha};
    }
    inline void configure(float dpi)
    {
        ImGui::StyleColorsDark();
        auto& s             = ImGui::GetStyle();
        s.WindowRounding    = 0;
        s.ChildRounding     = 5;
        s.FrameRounding     = 3;
        s.PopupRounding     = 7;
        s.ScrollbarRounding = 5;
        s.GrabRounding      = 4;
        s.TabRounding       = 4;
        s.WindowBorderSize  = 0;
        s.ChildBorderSize   = 0;
        s.FrameBorderSize   = 0;
        s.PopupBorderSize   = 1;
        s.WindowPadding     = {12, 10};
        s.FramePadding      = {8, 5};
        s.ItemSpacing       = {8, 6};
        s.ItemInnerSpacing  = {6, 4};
        s.ScrollbarSize     = 10;
        s.IndentSpacing     = 16;
        auto set            = [&](ImGuiCol key, unsigned value, float a = 1) { s.Colors[key] = color(value, a); };
        set(ImGuiCol_Text, 0xe1e4e9);
        set(ImGuiCol_TextDisabled, 0xa1a5ac);
        set(ImGuiCol_WindowBg, 0x202124);
        set(ImGuiCol_ChildBg, 0x202124);
        set(ImGuiCol_PopupBg, 0x292b2e);
        set(ImGuiCol_Border, 0x393b3f);
        set(ImGuiCol_BorderShadow, 0x000000, 0);
        set(ImGuiCol_FrameBg, 0x292b2e);
        set(ImGuiCol_FrameBgHovered, 0x33373d);
        set(ImGuiCol_FrameBgActive, 0x3b4047);
        set(ImGuiCol_TitleBg, 0x202124);
        set(ImGuiCol_TitleBgActive, 0x202124);
        set(ImGuiCol_MenuBarBg, 0x202124);
        set(ImGuiCol_Button, 0x292b2e);
        set(ImGuiCol_ButtonHovered, 0x33373d);
        set(ImGuiCol_ButtonActive, 0x454b54);
        set(ImGuiCol_Header, 0x395a76);
        set(ImGuiCol_HeaderHovered, 0x33373d);
        set(ImGuiCol_HeaderActive, 0x466d8e);
        set(ImGuiCol_CheckMark, 0xb4bcc7);
        set(ImGuiCol_SliderGrab, 0xa1a5ac);
        set(ImGuiCol_SliderGrabActive, 0xb4bcc7);
        set(ImGuiCol_Separator, 0x393b3f);
        set(ImGuiCol_SeparatorHovered, 0x656c77);
        set(ImGuiCol_SeparatorActive, 0xaab2bd);
        set(ImGuiCol_ScrollbarBg, 0x202124);
        set(ImGuiCol_ScrollbarGrab, 0x444951);
        set(ImGuiCol_ScrollbarGrabHovered, 0x555c66);
        set(ImGuiCol_ScrollbarGrabActive, 0x6c7583);
        set(ImGuiCol_TextSelectedBg, 0x606875);
        set(ImGuiCol_ResizeGrip, 0x000000, 0);
        auto& io = ImGui::GetIO();
        dpi      = std::max(1.f, dpi);
        io.Fonts->Clear();
        io.Fonts->TexDesiredWidth = 2048;
        ImFontConfig cfg;
        cfg.OversampleH = 2;
        cfg.OversampleV = 1;
        const char* fonts[]{
          "/System/Library/Fonts/Supplemental/Arial.ttf",
          "C:/Windows/Fonts/segoeui.ttf",
          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"};
        ImFont* regular = nullptr;
        for (auto path : fonts)
            if (std::filesystem::exists(path))
            {
                regular = io.Fonts->AddFontFromFileTTF(path, 14 * dpi, &cfg);
                if (regular)
                    break;
            }
        if (!regular)
        {
            cfg.SizePixels = 14 * dpi;
            regular        = io.Fonts->AddFontDefault(&cfg);
        }
        io.FontDefault     = regular;
        io.FontGlobalScale = 1 / dpi;
        for (auto path :
             {"/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
              "C:/Windows/Fonts/msyh.ttc",
              "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"})
            if (std::filesystem::exists(path))
            {
                ImFontConfig merge;
                merge.MergeMode   = true;
                merge.OversampleH = 2;
                merge.OversampleV = 1;
                io.Fonts->AddFontFromFileTTF(path, 14 * dpi, &merge, io.Fonts->GetGlyphRangesChineseSimplifiedCommon());
                break;
            }
        for (auto path :
             {"/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "C:/Windows/Fonts/seguisb.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"})
            if (std::filesystem::exists(path))
            {
                bold = io.Fonts->AddFontFromFileTTF(path, 14 * dpi, &cfg);
                if (bold && !language::chinese)
                    break;
            }
    }
    inline void heading(const char* text)
    {
        if (bold && !language::chinese)
            ImGui::PushFont(bold);
        ImGui::TextUnformatted(text);
        if (bold && !language::chinese)
            ImGui::PopFont();
    }
    inline bool tool(const char* label, bool active)
    {
        if (active)
            ImGui::PushStyleColor(ImGuiCol_Button, ImGui::GetStyle().Colors[ImGuiCol_Header]);
        bool clicked = ImGui::Button(label);
        if (active)
            ImGui::PopStyleColor();
        return clicked;
    }
    enum class Icon { Pointer, Move, Rotate, Scale, Settings, Add, Duplicate, Delete, Camera, Light, Group, Mesh };

    inline void icon(ImDrawList* draw, ImVec2 center, ImU32 tint, Icon kind)
    {
        const auto at = [&](float x, float y) { return ImVec2{center.x + x, center.y + y}; };
        const auto line = [&](float x, float y, float endX, float endY) {
            draw->AddLine(at(x, y), at(endX, endY), tint, 1.3f);
        };
        const auto box = [&](float x, float y, float endX, float endY) {
            draw->AddRect(at(x, y), at(endX, endY), tint, 1);
        };
        switch (kind)
        {
        case Icon::Pointer:
            line(-5, -7, 6, 1); line(6, 1, 0, 2); line(0, 2, -3, 7); line(-3, 7, -5, -7);
            break;
        case Icon::Move:
            line(-7, 0, 7, 0); line(0, -7, 0, 7);
            line(-7, 0, -4, -3); line(-7, 0, -4, 3); line(7, 0, 4, -3); line(7, 0, 4, 3);
            line(0, -7, -3, -4); line(0, -7, 3, -4); line(0, 7, -3, 4); line(0, 7, 3, 4);
            break;
        case Icon::Rotate:
            draw->PathArcTo(center, 6, -.65f, 4.8f, 18);
            draw->PathStroke(tint, 0, 1.3f);
            line(5, -7, 5, -3); line(1, -3, 5, -3);
            break;
        case Icon::Scale:
            box(-6, -6, 6, 6); line(-3, 3, 3, -3); line(0, -3, 3, -3); line(3, -3, 3, 0);
            break;
        case Icon::Settings:
            line(-7, -5, 7, -5); line(-7, 0, 7, 0); line(-7, 5, 7, 5);
            line(-3, -7, -3, -3); line(3, -2, 3, 2); line(0, 3, 0, 7);
            break;
        case Icon::Add:
            line(-6, 0, 6, 0); line(0, -6, 0, 6);
            break;
        case Icon::Duplicate:
            box(-2, -2, 6, 6); line(-6, 2, -6, -6); line(-6, -6, 2, -6);
            break;
        case Icon::Delete:
            line(-6, -4, 6, -4); box(-4, -4, 4, 6); line(-2, -7, 2, -7);
            break;
        case Icon::Camera:
            box(-7, -4, 2, 4); line(2, -1, 7, -4); line(7, -4, 7, 4); line(7, 4, 2, 1);
            break;
        case Icon::Light:
            draw->AddCircle(at(0, -2), 4, tint, 16, 1.3f);
            line(-2, 4, 2, 4); line(-1, 6, 1, 6);
            break;
        case Icon::Group:
            line(-7, -3, -3, -3); line(-3, -3, -2, -1); box(-7, -1, 7, 5); line(-7, -3, -7, -1);
            break;
        case Icon::Mesh:
            line(0, -7, 6, -3); line(6, -3, 6, 4); line(6, 4, 0, 7); line(0, 7, -6, 4);
            line(-6, 4, -6, -3); line(-6, -3, 0, -7); line(-6, -3, 0, 0); line(0, 0, 6, -3); line(0, 0, 0, 7);
            break;
        }
    }

    inline bool iconButton(const char* label, Icon glyph, bool active = false)
    {
        if (active) ImGui::PushStyleColor(ImGuiCol_Button, color(0x395a76));
        const bool clicked = ImGui::Button(label, {28, 26});
        if (active) ImGui::PopStyleColor();
        const auto min = ImGui::GetItemRectMin(), max = ImGui::GetItemRectMax();
        auto* draw = ImGui::GetWindowDrawList();
        if (active) draw->AddRect(min, max, IM_COL32(123, 182, 238, 255), 3);
        icon(draw, {(min.x + max.x) * .5f, (min.y + max.y) * .5f}, ImGui::GetColorU32(ImGuiCol_Text), glyph);
        return clicked;
    }
    inline bool vector(const char* label, const char* id, float* values, const char* format = "%.2f")
    {
        bool changed = false;
        if (ImGui::BeginTable(id, 4, ImGuiTableFlags_SizingStretchSame | ImGuiTableFlags_NoPadOuterX))
        {
            ImGui::TableSetupColumn("Property", ImGuiTableColumnFlags_WidthFixed, 75.f);
            ImGui::TableNextColumn();
            ImGui::AlignTextToFramePadding();
            ImGui::TextDisabled("%s", label);
            for (int k = 0; k < 3; ++k)
            {
                ImGui::TableNextColumn();
                ImGui::PushID(k);
                char name[]{char('X' + k), 0};
                ImGui::AlignTextToFramePadding();
                ImGui::TextDisabled("%s", name);
                ImGui::SameLine();
                ImGui::SetNextItemWidth(-1);
                changed |= ImGui::InputFloat("##value", &values[k], 0, 0, format);
                ImGui::PopID();
            }
            ImGui::EndTable();
        }
        return changed;
    }
    inline void cube(ImDrawList* draw, ImVec2 p, ImU32 ink)
    {
        ImVec2 a{p.x, p.y - 8}, b{p.x + 8, p.y - 4}, c{p.x + 8, p.y + 5}, d{p.x, p.y + 9}, e{p.x - 8, p.y + 5},
          f{p.x - 8, p.y - 4}, m{p.x, p.y};
        for (auto edge :
             {std::pair<ImVec2, ImVec2>{a, b}, {b, c}, {c, d}, {d, e}, {e, f}, {f, a}, {f, m}, {b, m}, {m, d}})
            draw->AddLine(edge.first, edge.second, ink, 1.3f);
    }
} // namespace editor::theme
