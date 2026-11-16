#pragma once
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
        s.FrameRounding     = 5;
        s.PopupRounding     = 7;
        s.ScrollbarRounding = 5;
        s.GrabRounding      = 4;
        s.TabRounding       = 4;
        s.WindowBorderSize  = 0;
        s.ChildBorderSize   = 0;
        s.FrameBorderSize   = 1;
        s.PopupBorderSize   = 1;
        s.WindowPadding     = {12, 10};
        s.FramePadding      = {8, 5};
        s.ItemSpacing       = {8, 8};
        s.ItemInnerSpacing  = {6, 4};
        s.ScrollbarSize     = 10;
        s.IndentSpacing     = 16;
        auto set            = [&](ImGuiCol key, unsigned value, float a = 1) { s.Colors[key] = color(value, a); };
        set(ImGuiCol_Text, 0xe1e4e9);
        set(ImGuiCol_TextDisabled, 0x8d949e);
        set(ImGuiCol_WindowBg, 0x202226);
        set(ImGuiCol_ChildBg, 0x202226);
        set(ImGuiCol_PopupBg, 0x2a2d32);
        set(ImGuiCol_Border, 0x34373c);
        set(ImGuiCol_BorderShadow, 0x000000, 0);
        set(ImGuiCol_FrameBg, 0x2a2d32);
        set(ImGuiCol_FrameBgHovered, 0x33373d);
        set(ImGuiCol_FrameBgActive, 0x3b4047);
        set(ImGuiCol_TitleBg, 0x202226);
        set(ImGuiCol_TitleBgActive, 0x202226);
        set(ImGuiCol_MenuBarBg, 0x202226);
        set(ImGuiCol_Button, 0x2a2d32);
        set(ImGuiCol_ButtonHovered, 0x33373d);
        set(ImGuiCol_ButtonActive, 0x454b54);
        set(ImGuiCol_Header, 0x3b4047);
        set(ImGuiCol_HeaderHovered, 0x33373d);
        set(ImGuiCol_HeaderActive, 0x454b54);
        set(ImGuiCol_CheckMark, 0xb4bcc7);
        set(ImGuiCol_SliderGrab, 0x8d949e);
        set(ImGuiCol_SliderGrabActive, 0xb4bcc7);
        set(ImGuiCol_Separator, 0x34373c);
        set(ImGuiCol_SeparatorHovered, 0x656c77);
        set(ImGuiCol_SeparatorActive, 0xaab2bd);
        set(ImGuiCol_ScrollbarBg, 0x202226);
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
                if (bold)
                    break;
            }
    }
    inline void heading(const char* text)
    {
        if (bold)
            ImGui::PushFont(bold);
        ImGui::TextUnformatted(text);
        if (bold)
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
    inline bool vector(const char* label, const char* id, float* values, const char* format = "%.2f")
    {
        ImGui::TextDisabled("%s", label);
        bool changed = false;
        if (ImGui::BeginTable(id, 3, ImGuiTableFlags_SizingStretchSame | ImGuiTableFlags_NoPadOuterX))
        {
            for (int k = 0; k < 3; ++k)
            {
                ImGui::TableNextColumn();
                ImGui::PushID(k);
                char name[]{char('X' + k), 0};
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
