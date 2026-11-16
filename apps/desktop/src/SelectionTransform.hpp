#pragma once
#include "Hierarchy.hpp"
#include "Navigation.hpp"
namespace editor
{
    enum class TransformSpace
    {
        Local,
        World
    };
    struct SelectionFrame
    {
        std::vector<std::string> ids, roots;
        std::string              active;
        Matrix                   basis, inv;
    };
    inline SelectionFrame selectionFrame(
      const Json&                     scene,
      const std::vector<std::string>& ids,
      const std::string&              active,
      TransformSpace                  space,
      const AssetBounds&              bounds = {})
    {
        if (ids.empty() || std::find(ids.begin(), ids.end(), active) == ids.end())
            throw std::runtime_error("Select models first");
        auto roots = selectionRoots(scene, ids);
        assertEditable(scene, roots, true);
        for (const auto& id : ids)
            if (inheritedFlag(scene, id, "hidden"))
                throw std::runtime_error("Show selected nodes first");
        auto worlds = worldMatrices(scene);
        for (const auto& id : roots)
        {
            const auto& n = nodeById(scene, id);
            if (!n["parentId"].is_null() && !inverse(worlds.at(n["parentId"].get<std::string>())))
                throw std::runtime_error("Singular parent transform");
        }
        auto center = pivot(worlds.at(roots[0]));
        if (roots.size() > 1)
        {
            auto            all = subtreeIds(scene, roots);
            std::vector<V3> points;
            for (const auto& n : scene["nodes"])
            {
                auto id = n["id"].get<std::string>();
                if (!all.count(id) || inheritedFlag(scene, id, "hidden"))
                    continue;
                auto b = n.contains("assetId") ? bounds.find(n["assetId"].get<std::string>()) : bounds.end();
                if (n.contains("camera") || n.contains("light"))
                    points.push_back(pivot(worlds.at(id)));
                if (b != bounds.end())
                    for (auto p : boundsCorners(b->second))
                        points.push_back(point(worlds.at(id), p));
            }
            if (points.empty())
                for (const auto& id : roots)
                    points.push_back(pivot(worlds.at(id)));
            for (int k = 0; k < 3; k++)
            {
                double lo = INFINITY, hi = -INFINITY;
                for (auto p : points)
                {
                    lo = std::min(lo, p[k]);
                    hi = std::max(hi, p[k]);
                }
                center[k] = (lo + hi) * .5;
            }
        }
        auto basis = localMatrix(identity());
        if (space == TransformSpace::Local)
        {
            std::vector<Json> chain;
            auto              n = nodeById(scene, active);
            while (true)
            {
                chain.insert(chain.begin(), n);
                if (n["parentId"].is_null())
                    break;
                n = nodeById(scene, n["parentId"].get<std::string>());
            }
            for (const auto& n : chain)
            {
                auto t        = identity();
                t["rotation"] = n["transform"]["rotation"];
                basis         = multiply(basis, localMatrix(t));
            }
        }
        for (int k = 0; k < 3; k++)
            basis[12 + k] = float(center[k]);
        return {ids, roots, active, basis, *inverse(basis)};
    }
    struct SelectionGizmo
    {
        Gizmo          gizmo;
        SelectionFrame frame;
    };
    inline std::optional<SelectionGizmo> selectionGizmo(
      const Json&                     scene,
      const std::vector<std::string>& ids,
      const std::string&              active,
      TransformSpace                  space,
      Tool                            mode,
      Camera                          c,
      Size                            size,
      const AssetBounds&              bounds = {})
    {
        try
        {
            auto frame = selectionFrame(scene, ids, active, space, bounds);
            auto proxy = emptyScene();
            proxy["nodes"].push_back(
              {{"id", "frame"}, {"parentId", nullptr}, {"name", "frame"}, {"transform", decomposeTRS(frame.basis)}});
            proxy["nodes"].push_back(
              {{"id", "handle"}, {"parentId", "frame"}, {"name", "handle"}, {"transform", identity()}});
            auto g = gizmoFor(proxy, "handle", mode, c, size);
            if (!g)
                return {};
            g->id = active;
            return SelectionGizmo{*g, frame};
        }
        catch (...)
        {
            return {};
        }
    }
    inline Json selectionEdits(const Json& base, const SelectionFrame& frame, const Json& delta)
    {
        assertEditable(base, frame.roots, true);
        auto d = localMatrix(delta), unit = localMatrix(identity());
        for (auto v : d)
            if (!std::isfinite(v))
                throw std::runtime_error("Non-finite selection transform");
        for (double v : delta["scale"])
            if (std::abs(v) < 1e-6)
                throw std::runtime_error("Scale cannot be zero");
        bool unchanged = true;
        for (int k = 0; k < 16; k++)
            unchanged &= std::abs(d[k] - unit[k]) < 1e-8;
        auto worlds    = worldMatrices(base);
        auto operation = multiply(multiply(frame.basis, d), frame.inv);
        Json result    = Json::object();
        for (const auto& id : frame.roots)
        {
            const auto& n = nodeById(base, id);
            if (unchanged)
            {
                result[id] = n["transform"];
                continue;
            }
            auto parent = n["parentId"].is_null() ? unit : worlds.at(n["parentId"].get<std::string>());
            auto inv    = inverse(parent);
            if (!inv)
                throw std::runtime_error("Singular parent transform");
            try
            {
                result[id] = decomposeTRS(multiply(*inv, multiply(operation, worlds.at(id))));
            }
            catch (...)
            {
                throw std::runtime_error(
                  "Transform introduces shear; all changes cancelled. Use local axes or uniform scale.");
            }
        }
        return result;
    }
    inline void applySelectionEdits(Json& scene, const Json& edits)
    {
        std::vector<std::string> ids;
        for (auto it = edits.begin(); it != edits.end(); ++it)
            ids.push_back(it.key());
        assertEditable(scene, ids, true);
        for (auto& n : scene["nodes"])
        {
            auto id = n["id"].get<std::string>();
            if (edits.contains(id))
                n["transform"] = edits[id];
        }
    }
    inline Json readNodeTransform(const Json& scene, const std::string& id, TransformSpace space)
    {
        return space == TransformSpace::Local ? nodeById(scene, id)["transform"]
                                              : decomposeTRS(worldMatrices(scene).at(id));
    }
    inline void writeNodeTransform(Json& scene, const std::string& id, TransformSpace space, const Json& value)
    {
        assertEditable(scene, {id}, true);
        for (double v : value["scale"])
            if (std::abs(v) < 1e-6)
                throw std::runtime_error("Scale cannot be zero");
        auto        local = value;
        const auto& n     = nodeById(scene, id);
        if (space == TransformSpace::World && !n["parentId"].is_null())
        {
            auto inv = inverse(worldMatrices(scene).at(n["parentId"].get<std::string>()));
            if (!inv)
                throw std::runtime_error("Singular parent transform");
            local = decomposeTRS(multiply(*inv, localMatrix(value)));
        }
        for (auto& node : scene["nodes"])
            if (node["id"] == id)
                node["transform"] = local;
    }
} // namespace editor
