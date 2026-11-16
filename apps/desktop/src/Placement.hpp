#pragma once
#include "Navigation.hpp"
#include <functional>
#include <limits>
namespace editor
{
    struct SurfaceHit
    {
        std::string id;
        V3          position;
    };
    using SurfaceQuery = std::function<std::optional<SurfaceHit>(Ray, const std::set<std::string>&)>;
    using FilteredPick =
      std::function<std::optional<SurfaceHit>(Ray, const std::set<std::string>&, const std::set<std::string>&)>;
    inline SurfaceQuery surfaceQuery(const Json& scene, FilteredPick pick)
    {
        std::set<std::string> allowed;
        for (const auto& n : scene["nodes"])
            if (n.contains("assetId"))
                allowed.insert(n["id"].get<std::string>());
        return [allowed, pick](Ray ray, const std::set<std::string>& excluded) -> std::optional<SurfaceHit> {
            if (allowed.empty())
                return {};
            auto hit = pick(ray, allowed, excluded);
            if (!hit || !allowed.count(hit->id) || excluded.count(hit->id))
                return {};
            for (auto v : hit->position)
                if (!std::isfinite(v))
                    return {};
            return hit;
        };
    }
    inline AssetBounds modelBoxes(const Json& scene, const AssetBounds& assets)
    {
        auto        worlds = worldMatrices(scene);
        AssetBounds out;
        for (const auto& n : scene["nodes"])
            if (n.contains("assetId"))
            {
                auto it = assets.find(n["assetId"].get<std::string>());
                if (it == assets.end())
                    continue;
                Bounds b{{INFINITY, INFINITY, INFINITY}, {-INFINITY, -INFINITY, -INFINITY}};
                for (auto p : boundsCorners(it->second))
                {
                    p = point(worlds.at(n["id"].get<std::string>()), p);
                    for (int k = 0; k < 3; k++)
                    {
                        b.minimum[k] = std::min(b.minimum[k], p[k]);
                        b.maximum[k] = std::max(b.maximum[k], p[k]);
                    }
                }
                out[n["id"].get<std::string>()] = b;
            }
        return out;
    }
    inline double supportHeight(
      Bounds                       box,
      double                       ceiling,
      const AssetBounds&           boxes,
      const SurfaceQuery&          query,
      const std::set<std::string>& excluded)
    {
        double                              height = 0;
        std::set<std::pair<double, double>> probes;
        for (const auto& [id, b] : boxes)
            if (!excluded.count(id) && b.minimum[1] <= ceiling + .002 && b.maximum[1] >= 0)
            {
                double x0 = std::max(box.minimum[0], b.minimum[0]), x1 = std::min(box.maximum[0], b.maximum[0]);
                double z0 = std::max(box.minimum[2], b.minimum[2]), z1 = std::min(box.maximum[2], b.maximum[2]);
                if (x0 > x1 || z0 > z1)
                    continue;
                for (double u : {0., .5, 1.})
                    for (double v : {0., .5, 1.})
                        probes.emplace(x0 + (x1 - x0) * u, z0 + (z1 - z0) * v);
            }
        for (auto [x, z] : probes)
        {
            auto hit = query({{x, ceiling + .002, z}, {0, -1, 0}}, excluded);
            if (hit && hit->position[1] <= ceiling + .003)
                height = std::max(height, hit->position[1]);
        }
        return height;
    }
    inline std::optional<Json> placementAt(
      Screen              p,
      Camera              c,
      Size                size,
      Bounds              b,
      bool                snap   = true,
      double              step   = 1,
      const Json*         scene  = nullptr,
      const AssetBounds*  assets = nullptr,
      const SurfaceQuery& query  = {})
    {
        if (
          size.width <= 0 || size.height <= 0 || p.x < 0 || p.y < 0 || p.x > size.width || p.y > size.height
          || !std::isfinite(step) || step <= 0)
            return {};
        if (!std::isfinite(p.x) || !std::isfinite(p.y))
            return {};
        auto              ray      = rayAt(p, c, size);
        auto              modelHit = query ? query(ray, {}) : std::optional<SurfaceHit>{};
        std::optional<V3> hit;

        if (modelHit)
        {
            hit = modelHit->position;
        }
        double t = std::abs(ray.direction[1]) < 1e-6 ? -1 : -ray.origin[1] / ray.direction[1];
        if (t >= 0 && std::isfinite(t))
        {
            auto ground = add(ray.origin, times(ray.direction, t));
            if (
              !hit
              || dot(sub(ground, ray.origin), sub(ground, ray.origin))
                   < dot(sub(*hit, ray.origin), sub(*hit, ray.origin)))
            {
                hit = ground;
            }
        }
        if (!hit || !project(*hit, c, size))
            return {};
        auto out = identity();
        V3   position{
          snap ? std::floor((*hit)[0] / step + .5) * step : (*hit)[0],
          0,
          snap ? std::floor((*hit)[2] / step + .5) * step : (*hit)[2]};
        double support = 0;
        if (query && scene && assets)
        {
            auto   boxes   = modelBoxes(*scene, *assets);
            double ceiling = 0;
            for (const auto& [id, b] : boxes)
                ceiling = std::max(ceiling, b.maximum[1]);
            auto footprint = b;
            for (int k = 0; k < 3; k++)
            {
                footprint.minimum[k] += position[k];
                footprint.maximum[k] += position[k];
            }
            support = supportHeight(footprint, ceiling, boxes, query, {});
        }
        position[1] = support - b.minimum[1];
        if (std::abs(position[1]) < 1e-6)
            position[1] = 0;
        out["position"] = position;
        return out;
    }
    inline std::optional<Json> groundedTransform(
      const Json& scene, const std::string& id, const AssetBounds& assets, const SurfaceQuery& query = {})
    {
        const Json* root = nullptr;
        for (const auto& n : scene["nodes"])
            if (n["id"] == id)
                root = &n;
        if (!root)
            return {};
        std::set<std::string> ids{id};
        bool                  changed = true;
        while (changed)
        {
            changed = false;
            for (const auto& n : scene["nodes"])
                if (!n["parentId"].is_null() && ids.count(n["parentId"].get<std::string>()))
                    changed |= ids.insert(n["id"].get<std::string>()).second;
        }
        auto   worlds  = worldMatrices(scene);
        double minimum = std::numeric_limits<double>::infinity();
        for (const auto& n : scene["nodes"])
            if (ids.count(n["id"].get<std::string>()) && n.contains("assetId"))
            {
                auto it = assets.find(n["assetId"].get<std::string>());
                if (it == assets.end())
                    return {};
                if (it != assets.end())
                    for (auto p : boundsCorners(it->second))
                        minimum = std::min(minimum, point(worlds.at(n["id"].get<std::string>()), p)[1]);
            }
        if (!std::isfinite(minimum))
            return {};
        auto parent =
          (*root)["parentId"].is_null() ? localMatrix(identity()) : worlds.at((*root)["parentId"].get<std::string>());
        auto inv = inverse(parent);
        if (!inv)
            return {};
        auto   out      = (*root)["transform"];
        double distance = -minimum;
        if (query)
        {
            auto boxes = modelBoxes(scene, assets);
            for (const auto& id : ids)
                if (boxes.count(id))
                {
                    auto box = boxes.at(id);
                    distance =
                      std::max(distance, supportHeight(box, box.minimum[1], boxes, query, ids) - box.minimum[1]);
                }
        }
        if (std::abs(distance) < 1e-6)
            return out;
        auto delta = point(*inv, {0, distance, 0}, 0);
        for (int k = 0; k < 3; k++)
        {
            double value       = out["position"][k].get<double>() + delta[k];
            out["position"][k] = std::abs(value) < 1e-6 ? 0 : value;
        }
        return out;
    }
} // namespace editor
