#pragma once
#include "Gizmo.hpp"
namespace editor
{
    inline const Json& nodeById(const Json& s, const std::string& id)
    {
        for (const auto& n : s["nodes"])
            if (n["id"] == id)
                return n;
        throw std::runtime_error("Node no longer exists");
    }
    inline bool inheritedFlag(const Json& s, std::string id, const char* flag)
    {
        while (!id.empty())
        {
            const auto& n = nodeById(s, id);
            if (n.value(flag, false))
                return true;
            id = n["parentId"].is_null() ? "" : n["parentId"].get<std::string>();
        }
        return false;
    }
    inline std::set<std::string> subtreeIds(const Json& s, const std::vector<std::string>& ids)
    {
        std::set<std::string> all(ids.begin(), ids.end());
        bool                  changed = true;
        while (changed)
        {
            changed = false;
            for (const auto& n : s["nodes"])
                if (!n["parentId"].is_null() && all.count(n["parentId"].get<std::string>()))
                    changed = all.insert(n["id"].get<std::string>()).second || changed;
        }
        return all;
    }
    inline std::vector<std::string> selectionRoots(const Json& s, const std::vector<std::string>& ids)
    {
        std::set<std::string>    selected(ids.begin(), ids.end());
        std::vector<std::string> roots;
        for (const auto& id : ids)
            nodeById(s, id);
        for (const auto& n : s["nodes"])
        {
            auto id = n["id"].get<std::string>();
            if (!selected.count(id))
                continue;
            auto p      = n["parentId"];
            bool nested = false;
            while (!p.is_null())
            {
                if (selected.count(p.get<std::string>()))
                {
                    nested = true;
                    break;
                }
                p = nodeById(s, p.get<std::string>())["parentId"];
            }
            if (!nested)
                roots.push_back(id);
        }
        return roots;
    }
    inline void assertEditable(const Json& s, const std::vector<std::string>& ids, bool descendants = false)
    {
        auto all = descendants ? subtreeIds(s, ids) : std::set<std::string>(ids.begin(), ids.end());
        for (const auto& id : all)
            if (inheritedFlag(s, id, "locked"))
                throw std::runtime_error("Unlock the node or its parent first");
    }
    inline Json decomposeTRS(const Matrix& m)
    {
        std::array<V3, 3> columns{V3{m[0], m[1], m[2]}, V3{m[4], m[5], m[6]}, V3{m[8], m[9], m[10]}};
        V3                scale{};
        for (int i = 0; i < 3; i++)
        {
            scale[i] = std::sqrt(dot(columns[i], columns[i]));
            if (scale[i] < 1e-8)
                throw std::runtime_error("Cannot preserve world transform: zero scale");
        }
        if (dot(columns[0], cross(columns[1], columns[2])) < 0)
            scale[0] *= -1;
        auto r = columns;
        for (int i = 0; i < 3; i++)
            r[i] = times(r[i], 1 / scale[i]);
        if (std::abs(dot(r[0], r[1])) > 1e-5 || std::abs(dot(r[0], r[2])) > 1e-5 || std::abs(dot(r[1], r[2])) > 1e-5)
            throw std::runtime_error("Cannot preserve world transform: shear from non-uniform scale");
        double                a = r[0][0], b = r[1][1], c = r[2][2], trace = a + b + c;
        std::array<double, 4> q{};
        if (trace > 0)
        {
            auto v = std::sqrt(trace + 1) * 2;
            q      = {(r[1][2] - r[2][1]) / v, (r[2][0] - r[0][2]) / v, (r[0][1] - r[1][0]) / v, v / 4};
        }
        else if (a > b && a > c)
        {
            auto v = std::sqrt(1 + a - b - c) * 2;
            q      = {v / 4, (r[1][0] + r[0][1]) / v, (r[2][0] + r[0][2]) / v, (r[1][2] - r[2][1]) / v};
        }
        else if (b > c)
        {
            auto v = std::sqrt(1 + b - a - c) * 2;
            q      = {(r[1][0] + r[0][1]) / v, v / 4, (r[2][1] + r[1][2]) / v, (r[2][0] - r[0][2]) / v};
        }
        else
        {
            auto v = std::sqrt(1 + c - a - b) * 2;
            q      = {(r[2][0] + r[0][2]) / v, (r[2][1] + r[1][2]) / v, v / 4, (r[0][1] - r[1][0]) / v};
        }
        double length = 0;
        for (auto v : q)
            length += v * v;
        length = std::sqrt(length);
        for (auto& v : q)
            v /= length;
        Json t       = {{"position", {m[12], m[13], m[14]}}, {"rotation", q}, {"scale", scale}};
        auto rebuilt = localMatrix(t);
        for (int i = 0; i < 16; i++)
            if (std::abs(rebuilt[i] - m[i]) > 1e-4 * std::max(1.f, std::abs(m[i])))
                throw std::runtime_error("Cannot accurately preserve world transform");
        return t;
    }
    inline void reparentNodes(
      Json& s, const std::vector<std::string>& ids, const Json& parent, const std::string& before = "")
    {
        auto roots = selectionRoots(s, ids);
        if (roots.empty())
            return;
        assertEditable(s, roots, true);
        if (!parent.is_null())
            assertEditable(s, {parent.get<std::string>()});
        auto moving = subtreeIds(s, roots);
        if (!parent.is_null() && moving.count(parent.get<std::string>()))
            throw std::runtime_error("Cannot move into itself or a descendant");
        if (!before.empty() && (moving.count(before) || nodeById(s, before)["parentId"] != parent))
            throw std::runtime_error("Invalid sibling target");
        auto worlds = worldMatrices(s);
        auto inv    = parent.is_null() ? std::optional<Matrix>(localMatrix(identity()))
                                       : inverse(worlds.at(parent.get<std::string>()));
        if (!inv)
            throw std::runtime_error("Parent scale is not invertible");
        std::map<std::string, Json> transforms;
        for (const auto& id : roots)
            if (nodeById(s, id)["parentId"] != parent)
                transforms[id] = decomposeTRS(multiply(*inv, worlds.at(id)));
        Json moved = Json::array(), remaining = Json::array();
        for (auto n : s["nodes"])
        {
            auto id = n["id"].get<std::string>();
            if (std::find(roots.begin(), roots.end(), id) != roots.end())
            {
                n["parentId"] = parent;
                if (transforms.count(id))
                    n["transform"] = transforms.at(id);
                moved.push_back(n);
            }
            else
                remaining.push_back(n);
        }
        auto index = remaining.size();
        if (!before.empty())
            for (size_t i = 0; i < remaining.size(); i++)
                if (remaining[i]["id"] == before)
                    index = i;
        for (size_t i = 0; i < moved.size(); i++)
            remaining.insert(remaining.begin() + index + i, moved[i]);
        s["nodes"] = remaining;
    }
    inline void deleteNodes(Json& s, const std::vector<std::string>& ids)
    {
        assertEditable(s, ids, true);
        auto  all = subtreeIds(s, ids);
        auto& a   = s["nodes"];
        a.erase(
          std::remove_if(a.begin(), a.end(), [&](const Json& n) { return all.count(n["id"].get<std::string>()); }),
          a.end());
    }
    inline std::vector<std::string> duplicateNodes(
      Json& s, const std::vector<std::string>& ids, const std::function<std::string()>& makeId)
    {
        auto roots = selectionRoots(s, ids);
        assertEditable(s, roots, true);
        auto                               all = subtreeIds(s, roots);
        std::map<std::string, std::string> mapping;
        for (const auto& id : all)
            mapping[id] = makeId();
        Json copies = Json::array();
        for (auto n : s["nodes"])
        {
            auto id = n["id"].get<std::string>();
            if (!all.count(id))
                continue;
            n["id"] = mapping.at(id);
            if (n.contains("camera"))
                n["camera"]["primary"] = false;
            if (n.contains("light"))
                n["light"]["active"] = false;
            if (!n["parentId"].is_null() && mapping.count(n["parentId"].get<std::string>()))
                n["parentId"] = mapping.at(n["parentId"].get<std::string>());
            if (std::find(roots.begin(), roots.end(), id) != roots.end())
                n["name"] = n["name"].get<std::string>() + " copy";
            copies.push_back(n);
        }
        for (auto n : copies)
            s["nodes"].push_back(n);
        for (auto& id : roots)
            id = mapping.at(id);
        return roots;
    }
    inline std::string groupNodes(Json& s, const std::vector<std::string>& ids, const std::string& id)
    {
        auto roots = selectionRoots(s, ids);
        if (roots.empty())
            throw std::runtime_error("Select nodes first");
        assertEditable(s, roots, true);
        auto parent = nodeById(s, roots[0])["parentId"];
        for (const auto& key : roots)
            if (nodeById(s, key)["parentId"] != parent)
            {
                parent = nullptr;
                break;
            }
        auto draft = s;
        draft["nodes"].push_back({{"id", id}, {"name", "Group"}, {"parentId", parent}, {"transform", identity()}});
        reparentNodes(draft, roots, id);
        auto  group = nodeById(draft, id);
        auto& a     = draft["nodes"];
        a.erase(std::remove_if(a.begin(), a.end(), [&](const Json& n) { return n["id"] == id; }), a.end());
        size_t first = 0;
        while (first < s["nodes"].size() && s["nodes"][first]["id"] != roots[0])
            first++;
        a.insert(a.begin() + std::min(first, a.size()), group);
        s = draft;
        return id;
    }
    inline std::vector<std::string> ungroupNodes(Json& s, const std::vector<std::string>& ids)
    {
        auto                     draft = s;
        std::vector<std::string> selected;
        for (const auto& id : selectionRoots(draft, ids))
        {
            auto n = nodeById(draft, id);
            if (n.contains("assetId"))
                throw std::runtime_error("Only empty groups can be ungrouped");
            assertEditable(draft, {id}, true);
            std::vector<std::string> children;
            for (const auto& c : draft["nodes"])
                if (c["parentId"] == id)
                    children.push_back(c["id"].get<std::string>());
            reparentNodes(draft, children, n["parentId"], id);
            selected.insert(selected.end(), children.begin(), children.end());
            auto& a = draft["nodes"];
            a.erase(std::remove_if(a.begin(), a.end(), [&](const Json& c) { return c["id"] == id; }), a.end());
        }
        s = draft;
        return selected;
    }
    inline void setNodeFlag(Json& s, const std::vector<std::string>& ids, const char* flag, bool value)
    {
        for (const auto& id : ids)
        {
            const auto& n = nodeById(s, id);
            if (std::string(flag) == "hidden")
                assertEditable(s, {id});
            else if (!n["parentId"].is_null() && inheritedFlag(s, n["parentId"].get<std::string>(), "locked"))
                throw std::runtime_error("Unlock parent first");
        }
        for (auto& n : s["nodes"])
            if (std::find(ids.begin(), ids.end(), n["id"].get<std::string>()) != ids.end())
                n[flag] = value;
    }
} // namespace editor
