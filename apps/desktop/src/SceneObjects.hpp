#pragma once
#include "Lighting.hpp"
#include "RenderBridge.hpp"
#include "SelectionTransform.hpp"
namespace editor
{
    inline Matrix objectFrame(const Json& scene, const std::string& id)
    {
        auto              worlds = worldMatrices(scene);
        std::vector<Json> chain;
        auto              n = nodeById(scene, id);
        while (true)
        {
            chain.insert(chain.begin(), n);
            if (n["parentId"].is_null())
                break;
            n = nodeById(scene, n["parentId"].get<std::string>());
        }
        auto m = localMatrix(identity());
        for (const auto& n : chain)
        {
            auto t        = identity();
            t["rotation"] = n["transform"]["rotation"];
            m             = multiply(m, localMatrix(t));
        }
        for (int k = 0; k < 3; k++)
            m[12 + k] = worlds.at(id)[12 + k];
        return m;
    }
    inline Json viewTransform(Camera c)
    {
        auto   f    = cameraFrame(c);
        auto   back = times(f.forward, -1);
        Matrix m;
        for (int k = 0; k < 3; k++)
        {
            m[k]      = float(f.right[k]);
            m[4 + k]  = float(f.up[k]);
            m[8 + k]  = float(back[k]);
            m[12 + k] = float(f.eye[k]);
        }
        m[3] = m[7] = m[11] = 0;
        m[15]               = 1;
        return decomposeTRS(m);
    }
    inline Json createCamera(const std::string& id, const editor::OrbitCamera& c)
    {
        return {
          {"id", id},
          {"parentId", nullptr},
          {"name", "Camera"},
          {"transform",
           viewTransform({c.yaw, c.pitch, c.distance, c.orthographic, {c.target[0], c.target[1], c.target[2]}})},
          {"camera",
           {{"projection", c.orthographic ? "orthographic" : "perspective"},
            {"focusDistance", std::clamp(c.distance, .05f, 100.f)},
            {"orthographicSize", std::clamp(float(2 * c.distance * std::tan(3.141592653589793 / 8)), .05f, 80.f)},
            {"exposure", c.exposure},
            {"primary", false}}}};
    }
    inline Json createLight(const std::string& id)
    {
        return {
          {"id", id},
          {"parentId", nullptr},
          {"name", "Directional light"},
          {"transform",
           viewTransform(
             {std::atan2(-1., 2.) * 180 / 3.141592653589793,
              std::atan2(1.6, std::sqrt(5.)) * 180 / 3.141592653589793,
              5})},
          {"light",
           {{"type", "directional"},
            {"color", {1, 1, 1}},
            {"intensity", 3.5},
            {"shadows", true},
            {"softness", 1},
            {"active", false}}}};
    }
    inline void setPrimary(Json& scene, const std::string& id, const std::string& kind, bool enabled = true)
    {
        assertEditable(scene, {id});
        if (!nodeById(scene, id).contains(kind))
            throw std::runtime_error("Wrong node type");
        auto flag = kind == "camera" ? "primary" : "active";
        for (auto& n : scene["nodes"])
            if (n.contains(kind) && (n["id"] == id || enabled))
                n[kind][flag] = enabled && n["id"] == id;
    }
    inline std::string primaryCamera(const Json& scene)
    {
        for (const auto& n : scene["nodes"])
            if (n.contains("camera") && n["camera"]["primary"] == true && !inheritedFlag(scene, n["id"], "hidden"))
                return n["id"];
        return {};
    }
    inline std::optional<editor::OrbitCamera> sceneCamera(const Json& scene)
    {
        auto id = primaryCamera(scene);
        if (id.empty())
            return {};
        auto m    = objectFrame(scene, id);
        auto back = unit({m[8], m[9], m[10]}), right = unit({m[0], m[1], m[2]}), up = unit({m[4], m[5], m[6]});
        auto pitch = std::asin(std::clamp(back[1], -1., 1.)) * 180 / 3.141592653589793,
             yaw =
               (std::hypot(back[0], back[2]) < 1e-6 ? std::atan2(-right[2], right[0]) : std::atan2(back[0], back[2]))
               * 180 / 3.141592653589793;
        const auto& c        = nodeById(scene, id)["camera"];
        double      distance = c["projection"] == "orthographic"
                                 ? c["orthographicSize"].get<double>() / (2 * std::tan(3.141592653589793 / 8))
                                 : c["focusDistance"].get<double>();
        if (dot(up, cameraFrame({yaw, pitch, distance}).up) < .9999)
            throw std::runtime_error(
              "Camera roll is not connected to the editor preview; the SDK supports full view cameras");
        editor::OrbitCamera out;
        out.yaw          = float(yaw);
        out.pitch        = float(pitch);
        out.distance     = float(distance);
        out.exposure     = c["exposure"];
        out.orthographic = c["projection"] == "orthographic";
        auto target      = add(pivot(m), times(back, -distance));
        for (int k = 0; k < 3; k++)
            out.target[k] = float(target[k]);
        return out;
    }
    struct SceneDirectional
    {
        std::string                 id;
        render::DirectionalLight    light;
        render::SceneShadowSettings shadows;
    };
    inline std::optional<SceneDirectional> sceneDirectional(const Json& scene)
    {
        for (const auto& n : scene["nodes"])
            if (n.contains("light") && n["light"]["active"] == true)
            {
                auto             id        = n["id"].get<std::string>();
                const auto&      l         = n["light"];
                auto             m         = objectFrame(scene, id);
                auto             direction = unit({m[8], m[9], m[10]});
                bool             hidden    = inheritedFlag(scene, id, "hidden");
                SceneDirectional out;
                out.id = id;
                for (int k = 0; k < 3; k++)
                {
                    out.light.direction[k] = float(direction[k]);
                    out.light.color[k]     = l["color"][k];
                }
                out.light.intensity = hidden ? 0 : l["intensity"].get<float>();
                out.shadows         = {!hidden && l["shadows"].get<bool>(), l["softness"].get<float>()};
                return out;
            }
        return {};
    }
    inline void captureCamera(Json& scene, const std::string& id, const editor::OrbitCamera& c)
    {
        writeNodeTransform(
          scene,
          id,
          TransformSpace::World,
          viewTransform({c.yaw, c.pitch, c.distance, c.orthographic, {c.target[0], c.target[1], c.target[2]}}));
        for (auto& n : scene["nodes"])
            if (n["id"] == id)
            {
                if (!n.contains("camera"))
                    throw std::runtime_error("Select camera first");
                n["camera"]["projection"]    = c.orthographic ? "orthographic" : "perspective";
                n["camera"]["focusDistance"] = std::clamp(c.distance, .05f, 100.f);
                n["camera"]["orthographicSize"] =
                  std::clamp(float(2 * c.distance * std::tan(3.141592653589793 / 8)), .05f, 80.f);
                n["camera"]["exposure"] = c.exposure;
            }
    }
    inline void aimObject(Json& scene, const std::string& id, double yaw, double pitch)
    {
        assertEditable(scene, {id});
        if (!std::isfinite(yaw) || !std::isfinite(pitch) || std::abs(yaw) > 180 || std::abs(pitch) > 90)
            throw std::runtime_error("Invalid object aim");
        auto rotation = viewTransform({yaw, pitch, 1})["rotation"];
        for (auto& n : scene["nodes"])
            if (n["id"] == id)
                n["transform"]["rotation"] = rotation;
    }
    inline std::array<float, 2> localAim(const Json& n)
    {
        auto t        = identity();
        t["rotation"] = n["transform"]["rotation"];
        auto m        = localMatrix(t);
        return {
          float(std::atan2(m[8], m[10]) * 180 / 3.141592653589793),
          float(std::asin(std::clamp(double(m[9]), -1., 1.)) * 180 / 3.141592653589793)};
    }
    struct SceneGlyph
    {
        std::string                    id;
        bool                           camera = false, active = false;
        V3                             position;
        std::vector<std::pair<V3, V3>> lines;
    };
    inline std::vector<SceneGlyph> sceneGlyphs(const Json& scene, double aspect = 1.5)
    {
        std::vector<SceneGlyph> result;
        for (const auto& n : scene["nodes"])
        {
            auto id = n["id"].get<std::string>();
            if ((!n.contains("camera") && !n.contains("light")) || inheritedFlag(scene, id, "hidden"))
                continue;
            auto       m = objectFrame(scene, id);
            SceneGlyph g;
            g.id       = id;
            g.camera   = n.contains("camera");
            g.active   = g.camera ? n["camera"]["primary"].get<bool>() : n["light"]["active"].get<bool>();
            g.position = pivot(m);
            std::vector<std::pair<V3, V3>> local;
            if (g.camera)
            {
                double d = .8,
                       h = n["camera"]["projection"] == "orthographic" ? .4 : std::tan(3.141592653589793 / 8) * d,
                       w = h * std::clamp(aspect, .3, 3.);
                std::array<V3, 4> corners{V3{-w, -h, -d}, V3{w, -h, -d}, V3{w, h, -d}, V3{-w, h, -d}};
                for (int k = 0; k < 4; k++)
                {
                    local.push_back({corners[k], corners[(k + 1) % 4]});
                    local.push_back({{0, 0, 0}, corners[k]});
                }
                local.push_back({{-.15, .2, 0}, {.15, .2, 0}});
                local.push_back({{.15, .2, 0}, {0, .35, 0}});
                local.push_back({{0, .35, 0}, {-.15, .2, 0}});
            }
            else
            {
                for (int k = 0; k < 3; k++)
                {
                    V3 a{}, b{};
                    a[k] = -.2;
                    b[k] = .2;
                    local.push_back({a, b});
                }
                local.push_back({{0, 0, 0}, {0, 0, -1}});
                local.push_back({{0, 0, -1}, {.15, 0, -.75}});
                local.push_back({{0, 0, -1}, {-.15, 0, -.75}});
            }
            for (auto [a, b] : local)
                g.lines.push_back({point(m, a), point(m, b)});
            result.push_back(g);
        }
        return result;
    }
} // namespace editor
