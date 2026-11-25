#pragma once
#include <algorithm>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <map>
#include <nlohmann/json.hpp>
#include <optional>
#include <set>
#include <vector>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif
#include <stdexcept>
namespace editor
{
    using Json = nlohmann::json;
    inline Json identity()
    {
        return {{"position", {0, 0, 0}}, {"rotation", {0, 0, 0, 1}}, {"scale", {1, 1, 1}}};
    }
    inline Json emptyScene()
    {
        return {{"schemaVersion", 2}, {"name", "Untitled"}, {"nodes", Json::array()}, {"assets", Json::object()}};
    }
    inline Json defaultWorld()
    {
        return {
          {"environment",
           {{"map", nullptr}, {"name", ""}, {"rotation", 0}, {"intensity", 1}, {"backgroundIntensity", 1}}},
          {"background", {{"mode", "color"}, {"color", "#999999"}}},
          {"fog", {{"mode", "none"}, {"color", "#999999"}, {"near", 10}, {"far", 50}, {"density", .02}}}};
    }
    inline void validateWorld(const Json& w)
    {
        const auto range = [](const Json& v, double a, double b) {
            return v.is_number() && std::isfinite(v.get<double>()) && v.get<double>() >= a && v.get<double>() <= b;
        };
        const auto hex = [](const Json& v) {
            if (!v.is_string())
                return false;
            auto s = v.get<std::string>();
            return s.size() == 7 && s[0] == '#'
                   && std::all_of(s.begin() + 1, s.end(), [](unsigned char c) { return std::isxdigit(c); });
        };
        const auto& e = w.at("environment");
        const auto& b = w.at("background");
        const auto& f = w.at("fog");
        if (!e.at("map").is_null())
        {
            auto path = e["map"].get<std::string>();
            if (
              path.rfind("assets/", 0) != 0 || path.find_first_of("\\:") != std::string::npos
              || path.find("/../") != std::string::npos || path.find("/./") != std::string::npos
              || path.find("//") != std::string::npos)
                throw std::runtime_error("Unsafe environment path");
            for (unsigned char c : path)
                if (c < 32)
                    throw std::runtime_error("Unsafe environment path");
            if (path.size() < 5 || path.substr(path.size() - 5) != ".nenv")
                throw std::runtime_error("Invalid environment path");
        }
        if (
          !e.at("name").is_string() || !range(e.at("rotation"), -180, 180) || !range(e.at("intensity"), 0, 16)
          || !range(e.at("backgroundIntensity"), 0, 16) || (b.at("mode") != "color" && b.at("mode") != "environment")
          || !hex(b.at("color")) || (b["mode"] == "environment" && e["map"].is_null())
          || (f.at("mode") != "none" && f.at("mode") != "linear" && f.at("mode") != "exp2") || !hex(f.at("color"))
          || !range(f.at("near"), 0, 1000) || !range(f.at("far"), .001, 2000)
          || f["far"].get<double>() <= f["near"].get<double>() || !range(f.at("density"), 0, 1))
            throw std::runtime_error("Invalid environment, background or fog settings");
    }

    inline void validate(const Json& s)
    {
        if (
          !s.is_object()
          || (s.at("schemaVersion") != 1 && s.at("schemaVersion") != 2 && s.at("schemaVersion") != 3 && s.at("schemaVersion") != 4 && s.at("schemaVersion") != 5 && s.at("schemaVersion") != 6 && s.at("schemaVersion") != 7)
          || !s.at("name").is_string() || !s.at("nodes").is_array() || !s.at("assets").is_object())
            throw std::runtime_error("Unsupported or malformed scene");
        if (s.contains("world"))
        {
            if (s["schemaVersion"].get<int>() < 4)
                throw std::runtime_error("World settings require scene format 4");
            validateWorld(s["world"]);
        }
        for (auto it = s["assets"].begin(); it != s["assets"].end(); ++it)
        {
            if (it.value().contains("materialVariant"))
            {
                const auto& index = it.value()["materialVariant"];
                if (!index.is_number_integer() || index.get<double>() < 0 || index.get<double>() > 4294967295.0)
                    throw std::runtime_error("Invalid material variant index");
            }
            if (it.value().contains("sourceSpace") && !it.value()["sourceSpace"].is_boolean())
                throw std::runtime_error("Invalid asset coordinate space");
            if (s["schemaVersion"] == 1 && it.value().value("sourceSpace", false))
                throw std::runtime_error("Source units require scene format 2");
            if (it.value().contains("name") && !it.value()["name"].is_string())
                throw std::runtime_error("Invalid asset name");
            const auto path = it.value().at("path").get<std::string>();
            if (it.key().empty() || path.rfind("assets/", 0) != 0 || path.find_first_of("\\:") != std::string::npos)
                throw std::runtime_error("Invalid asset path");
            for (char c : path)
                if (static_cast<unsigned char>(c) < 32)
                    throw std::runtime_error("Invalid asset path");
            size_t start = 0;
            while (start <= path.size())
            {
                auto end  = path.find('/', start);
                auto part = path.substr(start, end == std::string::npos ? end : end - start);
                if (part.empty() || part == "." || part == "..")
                    throw std::runtime_error("Invalid asset path");
                if (end == std::string::npos)
                    break;
                start = end + 1;
            }
        }
        std::map<std::string, const Json*> nodes;
        for (const auto& n : s["nodes"])
        {
            auto id = n.at("id").get<std::string>();
            if (
              id.empty() || nodes.count(id) || !n.at("name").is_string()
              || !(n.at("parentId").is_null() || n.at("parentId").is_string()))
                throw std::runtime_error("Invalid node");
            for (auto flag : {"hidden", "locked"})
                if (n.contains(flag) && !n[flag].is_boolean())
                    throw std::runtime_error("Invalid node flag");
            if (n.contains("previewBehavior"))
            {
                const auto& behavior = n.at("previewBehavior");
                if (!behavior.is_object() || !behavior.contains("kind") || !behavior.at("kind").is_string() ||
                    !behavior.contains("amount") || !behavior.at("amount").is_number())
                    throw std::runtime_error("Invalid preview behavior");
                const auto kind = behavior.at("kind").get<std::string>();
                const auto amount = behavior.at("amount").get<double>();
                if ((kind != "spin" && kind != "bob") || !std::isfinite(amount) ||
                    amount < (kind == "spin" ? -360 : 0) || amount > (kind == "spin" ? 360 : 10) ||
                    n.contains("camera") || n.contains("light"))
                    throw std::runtime_error("Invalid preview behavior");
            }
            for (auto spec : {std::pair<const char*, size_t>{"position", 3}, {"rotation", 4}, {"scale", 3}})
            {
                const auto& a = n.at("transform").at(spec.first);
                if (!a.is_array() || a.size() != spec.second)
                    throw std::runtime_error("Invalid transform");
                for (const auto& v : a)
                    if (!v.is_number() || !std::isfinite(v.get<double>()))
                        throw std::runtime_error("Invalid transform");
            }
            double norm = 0;
            for (const auto& v : n["transform"]["rotation"])
            {
                double x = v.get<double>();
                norm += x * x;
            }
            if (std::abs(norm - 1) > .001)
                throw std::runtime_error("Invalid quaternion");
            if (
              n.contains("assetId")
              && (!n["assetId"].is_string() || !s["assets"].contains(n["assetId"].get<std::string>())))
                throw std::runtime_error("Missing asset reference");
            const auto range = [](const Json& v, double lo, double hi) {
                return v.is_number() && std::isfinite(v.get<double>()) && v.get<double>() >= lo
                       && v.get<double>() <= hi;
            };
            if (int(n.contains("assetId")) + int(n.contains("camera")) + int(n.contains("light")) > 1)
                throw std::runtime_error("Node components are mutually exclusive");
            if ((n.contains("camera") || n.contains("light")) && s["schemaVersion"].get<int>() < 3)
                throw std::runtime_error("Scene components require format 3");
            if (n.contains("camera"))
            {
                const auto& c = n["camera"];
                if (
                  !c.is_object() || (c.at("projection") != "perspective" && c.at("projection") != "orthographic")
                  || !range(c.at("focusDistance"), .05, 100) || !range(c.at("orthographicSize"), .05, 80)
                  || !range(c.at("exposure"), .01, 16) || !c.at("primary").is_boolean())
                    throw std::runtime_error("Invalid camera component");
                if (c.contains("verticalFov") || c.contains("nearPlane") || c.contains("farPlane"))
                {
                    if (
                      s["schemaVersion"].get<int>() < 5 || !range(c.at("verticalFov"), 1, 179)
                      || !range(c.at("nearPlane"), .0001, 1e6) || !range(c.at("farPlane"), .0002, 1e7)
                      || c["farPlane"].get<double>() <= c["nearPlane"].get<double>())
                        throw std::runtime_error("Invalid camera lens or format (requires v5)");
                }
            }
            if (n.contains("light"))
            {
                if (id.size() > 128)
                    throw std::runtime_error("Light ID exceeds 128 UTF-8 bytes");
                const auto& l = n["light"];
                if (
                  !l.is_object()
                  || (l.at("type") != "directional" && (s["schemaVersion"].get<int>() < 6 || (l.at("type") != "point" && l.at("type") != "spot" && l.at("type") != "rectangle")))
                  || !l.at("color").is_array() || l["color"].size() != 3 || !range(l.at("intensity"), 0, 100)
                  || !range(l.at("softness"), 0, 4) || !l.at("shadows").is_boolean() || !l.at("active").is_boolean())
                    throw std::runtime_error("Invalid light component");
                if (
                  l["type"] != "directional"
                  && (!range(l.at("range"), 0, 1e7) || (s["schemaVersion"].get<int>() < 7 && l["shadows"] != false)))
                    throw std::runtime_error("Invalid range or point/spot shadows require scene format 7");
                if (l["type"] == "rectangle"
                    && (s["schemaVersion"].get<int>() < 7 || !range(l.at("width"), .0001, 1e4)
                        || !range(l.at("height"), .0001, 1e4)))
                    throw std::runtime_error("Invalid rectangle dimensions");
                if(l["type"] == "spot" && (!range(l.at("innerConeAngle"),0,1.5707963267948966) || !range(l.at("outerConeAngle"),0,1.5707963267948966) || l["innerConeAngle"].get<double>() > l["outerConeAngle"].get<double>() || l["outerConeAngle"].get<double>() >= 1.5707963267948966))
                    throw std::runtime_error("Invalid spot cone angles");
                for (const auto& v : l["color"])
                    if (!range(v, 0, 1))
                        throw std::runtime_error("Invalid light color");
            }
            nodes[id] = &n;
        }
        int primary = 0, active = 0;
        for (const auto& n : s["nodes"])
        {
            if (n.contains("camera") && n["camera"]["primary"] == true)
                primary++;
            if (n.contains("light") && n["light"]["active"] == true)
                active++;
        }
        if (primary > 1 || (s["schemaVersion"].get<int>() < 6 && active > 1))
            throw std::runtime_error("Only one primary camera / active directional light supported");
        if (std::count_if(s["nodes"].begin(), s["nodes"].end(), [](const auto& n) { return n.contains("light"); }) > 16)
            throw std::runtime_error("Maximum 16 scene lights");
        for (const auto& [id, n] : nodes)
        {
            std::set<std::string> seen{id};
            auto                  parent = (*n)["parentId"];
            while (!parent.is_null())
            {
                auto key = parent.get<std::string>();
                if (!nodes.count(key) || !seen.insert(key).second)
                    throw std::runtime_error("Cyclic or missing parent");
                parent = nodes.at(key)->at("parentId");
            }
        }
    }
    inline Json read(const std::filesystem::path& p)
    {
        std::ifstream f(p);
        if (!f)
            throw std::runtime_error("Cannot open project");
        Json j;
        f >> j;
        validate(j);
        return j;
    }
    inline void save(const std::filesystem::path& p, const Json& s)
    {
        validate(s);
        auto tmp = p;
        tmp += ".tmp";
        {
            std::ofstream f(tmp);
            if (!f)
                throw std::runtime_error("Cannot create temporary project");
            f << s.dump(2) << '\n';
            f.flush();
            if (!f)
                throw std::runtime_error("Failed to write project");
        }
#ifdef _WIN32
        if (!MoveFileExW(tmp.c_str(), p.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
            throw std::runtime_error("Cannot replace project file");
#else
        std::filesystem::rename(tmp, p);
#endif
    }
    struct History
    {
        Json                scene = emptyScene();
        std::vector<Json>   past, future;
        std::optional<Json> previewBase;
        void                beginPreview()
        {
            cancelPreview();
            previewBase = scene;
        }
        void preview(Json next)
        {
            if (!previewBase)
                throw std::runtime_error("No active preview");
            validate(next);
            scene = std::move(next);
        }
        void cancelPreview()
        {
            if (previewBase)
            {
                scene = *previewBase;
                previewBase.reset();
            }
        }
        void finishPreview()
        {
            if (!previewBase)
                return;
            auto base = *previewBase;
            previewBase.reset();
            if (base != scene)
            {
                past.push_back(base);
                if (past.size() > 100)
                    past.erase(past.begin());
                future.clear();
            }
        }
        void commit(Json next)
        {
            validate(next);
            cancelPreview();
            if (next == scene)
                return;
            past.push_back(scene);
            if (past.size() > 100)
                past.erase(past.begin());
            scene = std::move(next);
            future.clear();
        }
        void undo()
        {
            cancelPreview();
            if (past.empty())
                return;
            future.push_back(scene);
            scene = past.back();
            past.pop_back();
        }
        void redo()
        {
            cancelPreview();
            if (future.empty())
                return;
            past.push_back(scene);
            scene = future.back();
            future.pop_back();
        }
        void replace(Json next)
        {
            cancelPreview();
            validate(next);
            scene = std::move(next);
            past.clear();
            future.clear();
        }
    };
    inline void removeSubtree(Json& s, const std::string& id)
    {
        std::set<std::string> ids{id};
        bool                  changed = true;
        while (changed)
        {
            changed = false;
            for (const auto& n : s["nodes"])
                if (!n["parentId"].is_null() && ids.count(n["parentId"].get<std::string>()))
                    changed = ids.insert(n["id"].get<std::string>()).second || changed;
        }
        auto& a = s["nodes"];
        a.erase(
          std::remove_if(a.begin(), a.end(), [&](const Json& n) { return ids.count(n["id"].get<std::string>()); }),
          a.end());
    }
} // namespace editor
