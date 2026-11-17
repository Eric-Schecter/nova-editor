#pragma once
#include "Gizmo.hpp"
namespace editor
{
    struct Bounds
    {
        V3 minimum{}, maximum{};
    };
    using AssetBounds = std::map<std::string, Bounds>;
    inline std::array<V3, 8> boundsCorners(Bounds b)
    {
        std::array<V3, 8> out;
        for (int bits = 0; bits < 8; bits++)
            for (int k = 0; k < 3; k++)
                out[bits][k] = (bits & (1 << k)) ? b.maximum[k] : b.minimum[k];
        return out;
    }
    inline std::optional<Bounds> sceneBounds(const Json& scene, const AssetBounds& assets, const std::string& root = "")
    {
        std::set<std::string> ids;
        if (root.empty())
        {
            for (const auto& n : scene["nodes"])
                ids.insert(n["id"].get<std::string>());
        }
        else
        {
            ids.insert(root);
            bool changed = true;
            while (changed)
            {
                changed = false;
                for (const auto& n : scene["nodes"])
                    if (!n["parentId"].is_null() && ids.count(n["parentId"].get<std::string>()))
                        changed |= ids.insert(n["id"].get<std::string>()).second;
            }
        }
        auto                  worlds = worldMatrices(scene);
        std::optional<Bounds> out;
        auto                  extend = [&](V3 p) {
            if (!out)
                out = Bounds{p, p};
            else
                for (int k = 0; k < 3; k++)
                {
                    out->minimum[k] = std::min(out->minimum[k], p[k]);
                    out->maximum[k] = std::max(out->maximum[k], p[k]);
                }
        };
        for (const auto& n : scene["nodes"])
            if (ids.count(n["id"].get<std::string>()))
            {
                auto m = worlds.at(n["id"].get<std::string>());
                if (n.contains("assetId"))
                {
                    auto it = assets.find(n["assetId"].get<std::string>());
                    if (it != assets.end())
                        for (auto p : boundsCorners(it->second))
                            extend(point(m, p));
                }
                else
                    extend(pivot(m));
            }
        return out;
    }
    inline Camera frameBounds(Camera c, std::optional<Bounds> b, Size s)
    {
        if (!b)
            return c;
        double radius = 0;
        for (int k = 0; k < 3; k++)
        {
            c.target[k] = (b->minimum[k] + b->maximum[k]) * .5;
            double half = (b->maximum[k] - b->minimum[k]) * .5;
            radius += half * half;
        }
        radius         = std::max(.02, std::sqrt(radius));
        double tangent = cameraTangent(c) * std::min(1., std::max(.01, s.width / std::max(1., s.height))),
               factor  = c.orthographic ? tangent : std::sin(std::atan(tangent));
        c.distance     = std::clamp(radius * 1.15 / factor, .05, 100.);
        return c;
    }
    inline Camera panCamera(Camera c, double dx, double dy, Size size)
    {
        auto   f    = cameraFrame(c);
        double unit = 2 * c.distance * cameraTangent(c) / std::max(1., size.height);
        c.target    = add(c.target, add(times(f.right, -dx * unit), times(f.up, dy * unit)));
        return c;
    }
} // namespace editor
