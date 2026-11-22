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
        auto node = Json{
          {"id", id},
          {"parentId", nullptr},
          {"name", "Camera"},
          {"transform", viewTransform(navigationCamera(c))},
          {"camera",
           {{"projection", c.orthographic ? "orthographic" : "perspective"},
            {"focusDistance", std::clamp(c.distance, .05f, 100.f)},
            {"orthographicSize", std::clamp(float(2 * c.distance * cameraTangent(navigationCamera(c))), .05f, 80.f)},
            {"exposure", c.exposure},
            {"primary", false}}}};
        if (c.verticalFov != 45 || c.nearPlane != .01f || c.farPlane != 200)
        {
            node["camera"]["verticalFov"] = c.verticalFov;
            node["camera"]["nearPlane"]   = c.nearPlane;
            node["camera"]["farPlane"]    = c.farPlane;
        }
        return node;
    }
    inline Json createLight(const std::string& id, const std::string& type = "directional")
    {
        return {
          {"id", id},
          {"parentId", nullptr},
          {"name",
           type == "directional" ? "Directional light"
           : type == "point"     ? "Point light"
                                 : "Spot light"},
          {"transform",
           viewTransform(
             {std::atan2(-1., 2.) * 180 / 3.141592653589793,
              std::atan2(1.6, std::sqrt(5.)) * 180 / 3.141592653589793,
              5})},
          {"light",
           {{"type", type},
            {"range", 10},
            {"innerConeAngle", .35},
            {"outerConeAngle", .6},
            {"color", {1, 1, 1}},
            {"intensity", 3.5},
            {"shadows", type == "directional"},
            {"softness", 1},
            {"active", false}}}};
    }
    inline void setPrimary(Json& scene, const std::string& id, const std::string& kind, bool enabled = true)
    {
        assertEditable(scene, {id});
        if (!nodeById(scene, id).contains(kind))
            throw std::runtime_error("Wrong node type");
        if (kind == "light")
        {
            scene["schemaVersion"] = std::max(6, scene["schemaVersion"].get<int>());
            for (auto& n : scene["nodes"])
                if (n["id"] == id)
                    n["light"]["active"] = enabled;
            return;
        }
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
    inline std::array<float, 3> anglesFromFrame(const Matrix& m)
    {
        auto   back = unit({m[8], m[9], m[10]}), right = unit({m[0], m[1], m[2]});
        bool   pole = std::hypot(back[0], back[2]) < 1e-6;
        double yaw  = (pole ? std::atan2(-right[2], right[0]) : std::atan2(back[0], back[2])) * 180 / 3.141592653589793,
               pitch =
                 pole ? (back[1] > 0 ? 90 : -90) : std::asin(std::clamp(back[1], -1., 1.)) * 180 / 3.141592653589793;
        auto   base = cameraFrame({yaw, pitch, 1});
        double roll = std::atan2(dot(right, base.up), dot(right, base.right)) * 180 / 3.141592653589793;
        return {float(yaw), float(pitch), float(roll)};
    }
    inline std::optional<editor::OrbitCamera> sceneCamera(const Json& scene)
    {
        auto id = primaryCamera(scene);
        if (id.empty())
            return {};
        auto                m      = objectFrame(scene, id);
        auto                angles = anglesFromFrame(m);
        const auto&         c      = nodeById(scene, id)["camera"];
        editor::OrbitCamera out;
        out.yaw          = angles[0];
        out.pitch        = angles[1];
        out.roll         = angles[2];
        out.verticalFov  = c.value("verticalFov", 45.f);
        out.nearPlane    = c.value("nearPlane", .01f);
        out.farPlane     = c.value("farPlane", 200.f);
        out.orthographic = c["projection"] == "orthographic";
        out.distance     = out.orthographic
                             ? float(c["orthographicSize"].get<double>() / (2 * cameraTangent(navigationCamera(out))))
                             : c["focusDistance"].get<float>();
        out.exposure     = c["exposure"];
        auto target      = add(pivot(m), times(unit({m[8], m[9], m[10]}), -out.distance));
        for (int k = 0; k < 3; k++)
            out.target[k] = float(target[k]);
        return out;
    }
    inline std::vector<render::SceneLight> sceneLights(const Json& scene)
    {
        std::vector<render::SceneLight> lights;
        for (const auto& n : scene["nodes"])
            if (n.contains("light"))
            {
                const auto&        l  = n["light"];
                auto               id = n["id"].get<std::string>();
                auto               m  = objectFrame(scene, id);
                render::SceneLight v;
                v.id             = id;
                v.type           = l["type"] == "point"  ? render::LightType::Point
                                   : l["type"] == "spot" ? render::LightType::Spot
                                                         : render::LightType::Directional;
                v.enabled        = l["active"].get<bool>() && !inheritedFlag(scene, id, "hidden");
                v.intensity      = l["intensity"];
                v.range          = l.value("range", 0.f);
                v.innerConeAngle = l.value("innerConeAngle", .35f);
                v.outerConeAngle = l.value("outerConeAngle", .6f);
                v.castShadow     = l["shadows"].get<bool>();
                v.shadowSoftness = l["softness"];
                auto d           = unit({m[8], m[9], m[10]});
                for (int k = 0; k < 3; k++)
                {
                    v.color[k]     = l["color"][k];
                    v.position[k]  = float(m[12 + k]);
                    v.direction[k] = float(d[k] * (v.type == render::LightType::Spot ? -1 : 1));
                }
                lights.push_back(v);
            }
        return lights;
    }
    inline void applySceneLights(
      render::Window&                    window,
      const Json&                        scene,
      const render::DirectionalLight&    fallback,
      const render::SceneShadowSettings& shadows)
    {
        auto lights = sceneLights(scene);
        if (lights.empty())
        {
            render::SceneLight light;
            light.id             = "__studio";
            light.direction      = fallback.direction;
            light.color          = fallback.color;
            light.intensity      = fallback.intensity;
            light.castShadow     = shadows.enabled;
            light.shadowSoftness = shadows.softness;
            lights.push_back(light);
        }
        window.SetLights(lights);
        window.SetShadows({true, 1, 2});
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
            if (n.contains("light"))
            {
                auto             id        = n["id"].get<std::string>();
                const auto&      l         = n["light"];
                auto             m         = objectFrame(scene, id);
                auto             direction = unit({m[8], m[9], m[10]});
                bool             hidden    = !l["active"].get<bool>() || inheritedFlag(scene, id, "hidden");
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
        assertEditable(scene, {id}, true);
        auto node = nodeById(scene, id);
        if (!node.contains("camera"))
            throw std::runtime_error("Select camera first");
        auto pose     = viewTransform(navigationCamera(c));
        auto position = pose["position"], rotation = pose["rotation"];
        if (!node["parentId"].is_null())
        {
            auto parent = node["parentId"].get<std::string>();
            auto inv    = inverse(worldMatrices(scene).at(parent));
            if (!inv)
                throw std::runtime_error("Parent transform is singular");
            V3 p{position[0], position[1], position[2]};
            position            = point(*inv, p);
            auto parentRotation = objectFrame(scene, parent);
            parentRotation[12] = parentRotation[13] = parentRotation[14] = 0;
            auto t                                                       = identity();
            t["rotation"]                                                = rotation;
            rotation = decomposeTRS(multiply(*inverse(parentRotation), localMatrix(t)))["rotation"];
        }
        for (auto& n : scene["nodes"])
            if (n["id"] == id)
            {
                if (!n.contains("camera"))
                    throw std::runtime_error("Select camera first");
                n["transform"]["position"]   = position;
                n["transform"]["rotation"]   = rotation;
                n["camera"]["projection"]    = c.orthographic ? "orthographic" : "perspective";
                n["camera"]["focusDistance"] = std::clamp(c.distance, .05f, 100.f);
                n["camera"]["orthographicSize"] =
                  std::clamp(float(2 * c.distance * cameraTangent(navigationCamera(c))), .05f, 80.f);
                n["camera"]["exposure"]    = c.exposure;
                n["camera"]["verticalFov"] = c.verticalFov;
                n["camera"]["nearPlane"]   = c.nearPlane;
                n["camera"]["farPlane"]    = c.farPlane;
                scene["schemaVersion"]     = std::max(5, scene["schemaVersion"].get<int>());
            }
    }
    inline void aimObject(Json& scene, const std::string& id, double yaw, double pitch, double roll = 0)
    {
        assertEditable(scene, {id}, true);
        if (
          !std::isfinite(yaw) || !std::isfinite(pitch) || std::abs(yaw) > 180 || std::abs(pitch) > 90
          || !std::isfinite(roll) || std::abs(roll) > 180)
            throw std::runtime_error("Invalid object aim");
        auto rotation = cameraOrientation(yaw, pitch, roll);
        for (auto& n : scene["nodes"])
            if (n["id"] == id)
                n["transform"]["rotation"] = rotation;
    }
    inline void aimLightAt(Json& scene, const std::string& id, V3 target)
    {
        constexpr double degrees = 57.29577951308232;
        for (const auto& node : scene["nodes"])
            if (node["id"] == id && node.contains("light") && node["light"]["type"] != "point")
            {
                auto delta = sub(pivot(objectFrame(scene, id)), target);
                if (!node["parentId"].is_null())
                {
                    const auto parent = inverse(objectFrame(scene, node["parentId"].get<std::string>()));
                    if (!parent) throw std::runtime_error("Parent transform is not invertible");
                    delta = point(*parent, delta, 0);
                }
                const auto horizontal = std::hypot(delta[0], delta[2]);
                if (std::hypot(horizontal, delta[1]) < 1e-6)
                    throw std::runtime_error("Target coincides with the light");
                aimObject(scene, id, std::atan2(delta[0], delta[2]) * degrees,
                          std::atan2(delta[1], horizontal) * degrees);
                return;
            }
        throw std::runtime_error("Select a directional light or spotlight");
    }
    inline std::array<float, 3> localAim(const Json& n)
    {
        auto t        = identity();
        t["rotation"] = n["transform"]["rotation"];
        return anglesFromFrame(localMatrix(t));
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
                       h = n["camera"]["projection"] == "orthographic"
                             ? .4
                             : std::tan(n["camera"].value("verticalFov", 45.) * 3.141592653589793 / 360) * d,
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
                const auto& light  = n["light"];
                double      radius = light.value("range", 0.);
                if (radius > 0 && light["type"] == "point")
                    for (int axis = 0; axis < 3; axis++)
                        for (int i = 0; i < 32; i++)
                        {
                            auto pointAt = [&](double a) {
                                V3 p{};
                                p[(axis + 1) % 3] = std::cos(a) * radius;
                                p[(axis + 2) % 3] = std::sin(a) * radius;
                                return p;
                            };
                            local.push_back(
                              {pointAt(i * 3.141592653589793 / 16), pointAt((i + 1) * 3.141592653589793 / 16)});
                        }
                if (light["type"] == "spot")
                    for (double angle : {light.value("innerConeAngle", .35), light.value("outerConeAngle", .6)})
                    {
                        double d = radius > 0 ? radius : 2, r = std::tan(angle) * d;
                        auto   pointAt = [&](double a) { return V3{std::cos(a) * r, std::sin(a) * r, -d}; };
                        for (int i = 0; i < 32; i++)
                            local.push_back(
                              {pointAt(i * 3.141592653589793 / 16), pointAt((i + 1) * 3.141592653589793 / 16)});
                        for (int i = 0; i < 4; i++)
                            local.push_back({{0, 0, 0}, pointAt(i * 3.141592653589793 / 2)});
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
