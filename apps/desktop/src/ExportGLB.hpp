#pragma once
#include "ModelEditing.hpp"
namespace editor::assets
{
    inline Bytes exportGLB(
      const Json&                                     scene,
      const std::function<Bytes(const std::string&)>& load,
      const std::optional<std::vector<std::string>>&  selection = std::nullopt)
    {
        validate(scene);
        std::set<std::string>       content, included;
        std::map<std::string, Json> nodes;
        for (const auto& n : scene.at("nodes"))
            nodes[n.at("id").get<std::string>()] = n;
        if (selection)
        {
            if (selection->empty())
                throw std::runtime_error("Select objects to export");
            for (const auto& id : *selection)
            {
                if (!nodes.count(id))
                    throw std::runtime_error("Invalid export selection");
                content.insert(id);
            }
            bool changed = true;
            while (changed)
            {
                changed = false;
                for (const auto& [id, n] : nodes)
                    if (
                      !n["parentId"].is_null() && content.count(n["parentId"].get<std::string>()) && !content.count(id))
                    {
                        content.insert(id);
                        changed = true;
                    }
            }
        }
        else
            for (const auto& [id, n] : nodes)
                content.insert(id);
        included = content;
        for (const auto& id : content)
        {
            auto n = nodes.at(id);
            while (!n["parentId"].is_null())
            {
                auto p = n["parentId"].get<std::string>();
                included.insert(p);
                n = nodes.at(p);
            }
        }
        Json j = {
          {"asset", {{"version", "2.0"}, {"generator", "Nova Editor"}}},
          {"scene", 0},
          {"scenes", Json::array({{{"name", scene.at("name")}, {"nodes", Json::array()}}})},
          {"nodes", Json::array()}, {"skins", Json::array()}, {"animations", Json::array()}};
        const std::vector<std::string> keys{
          "bufferViews", "accessors", "images", "samplers", "textures", "materials", "meshes", "cameras"};
        for (const auto& k : keys)
            j[k] = Json::array();
        Bytes                 bin;
        std::set<std::string> used, required;
        struct Graph
        {
            size_t              start, end;
            std::vector<size_t> roots;
            Json skins, animations;
        };
        std::map<std::string, Graph> graphs;
        for (const auto& n : scene["nodes"])
            if (content.count(n["id"].get<std::string>()) && n.contains("assetId"))
            {
                auto id = n["assetId"].get<std::string>();
                if (graphs.count(id))
                    continue;
                auto doc = readGLB(load(scene["assets"][id]["path"].get<std::string>()));
                auto s   = doc.json;
                if (!doc.extra.empty())
                    throw std::runtime_error("Custom GLB chunks cannot be exported");
                for (const auto& e : s.value("extensionsUsed", Json::array()))
                {
                    auto ext = e.get<std::string>();
                    if (
                      ext == "KHR_materials_variants"
                      || (ext.rfind("KHR_materials_", 0) != 0 && ext != "KHR_texture_transform" && ext != "KHR_mesh_quantization"))
                        throw std::runtime_error("Unsupported GLB extension: " + ext);
                    used.insert(ext);
                }
                for (const auto& e : s.value("extensionsRequired", Json::array()))
                {
                    auto ext = e.get<std::string>();
                    if (!used.count(ext))
                        throw std::runtime_error("Invalid required extension");
                    required.insert(ext);
                }
                std::map<std::string, size_t> base;
                for (const auto& k : keys)
                    base[k] = j[k].size();
                base["nodes"] = j["nodes"].size();
                bin.resize((bin.size() + 3) / 4 * 4);
                auto offset = bin.size();
                bin.insert(bin.end(), doc.bin.begin(), doc.bin.end());
                if (bin.size() > maxBytes)
                    throw std::runtime_error("Export exceeds 128 MiB");
                for (auto& v : s["bufferViews"])
                {
                    auto start = v.value("byteOffset", size_t(0)), len = v.at("byteLength").get<size_t>();
                    if (v["buffer"] != 0 || start > doc.bin.size() || len > doc.bin.size() - start)
                        throw std::runtime_error("Export buffer out of bounds");
                    v["buffer"]     = 0;
                    v["byteOffset"] = start + offset;
                }
                auto view = [&](Json& o) {
                    if (o.contains("bufferView"))
                        o["bufferView"] = o["bufferView"].get<size_t>() + base["bufferViews"];
                };
                for (auto& a : s["accessors"])
                {
                    view(a);
                    if (a.contains("sparse"))
                    {
                        view(a["sparse"]["indices"]);
                        view(a["sparse"]["values"]);
                    }
                }
                for (auto& img : s["images"])
                {
                    if (img.contains("uri") || !img.contains("bufferView"))
                        throw std::runtime_error("Embedded images required for export");
                    view(img);
                }
                for (auto& t : s["textures"])
                {
                    if (t.contains("source"))
                        t["source"] = t["source"].get<size_t>() + base["images"];
                    if (t.contains("sampler"))
                        t["sampler"] = t["sampler"].get<size_t>() + base["samplers"];
                }
                std::function<void(Json&)> textures = [&](Json& o) {
                    if (!o.is_structured())
                        return;
                    for (auto it = o.begin(); it != o.end(); ++it)
                    {
                        auto& v = it.value();
                        if (!v.is_structured())
                            continue;
                        auto k = o.is_object() ? it.key() : "";
                        if (k.size() >= 7 && k.substr(k.size() - 7) == "Texture" && v.contains("index"))
                            v["index"] = v["index"].get<size_t>() + base["textures"];
                        else
                            textures(v);
                    }
                };
                for (auto& m : s["materials"])
                    textures(m);
                for (auto& m : s["meshes"])
                    for (auto& p : m["primitives"])
                    {
                        for (auto& a : p["attributes"])
                            a = a.get<size_t>() + base["accessors"];
                        if (p.contains("indices"))
                            p["indices"] = p["indices"].get<size_t>() + base["accessors"];
                        if (p.contains("material"))
                            p["material"] = p["material"].get<size_t>() + base["materials"];
                        for (auto& t : p["targets"])
                            for (auto& a : t)
                                a = a.get<size_t>() + base["accessors"];
                        if (p["targets"].is_null())
                            p.erase("targets");
                    }
                for (auto& n : s["nodes"])
                {
                    if (n.contains("mesh"))
                        n["mesh"] = n["mesh"].get<size_t>() + base["meshes"];
                    if (n.contains("camera"))
                        n["camera"] = n["camera"].get<size_t>() + base["cameras"];
                    for (auto& c : n["children"])
                        c = c.get<size_t>() + base["nodes"];
                    if (n["children"].is_null())
                        n.erase("children");
                }
                for (const auto& k : keys)
                    if (s[k].is_array())
                        for (const auto& v : s[k])
                            j[k].push_back(v);
                if (s["nodes"].is_array())
                    for (const auto& v : s["nodes"])
                        j["nodes"].push_back(v);
                Graph g{base["nodes"], j["nodes"].size(), {},
                    s.value("skins", Json::array()), s.value("animations", Json::array())};
                for (auto& skin : g.skins)
                    if (skin.contains("inverseBindMatrices"))
                        skin["inverseBindMatrices"] = skin["inverseBindMatrices"].get<size_t>() + base["accessors"];
                for (auto& clip : g.animations)
                    for (auto& sampler : clip.at("samplers"))
                    {
                        sampler["input"] = sampler.at("input").get<size_t>() + base["accessors"];
                        sampler["output"] = sampler.at("output").get<size_t>() + base["accessors"];
                    }
                if (!s.value("scenes", Json::array()).empty())
                    for (const auto& r : s["scenes"].at(s.value("scene", size_t(0)))["nodes"])
                        g.roots.push_back(r.get<size_t>() + base["nodes"]);
                else if (!s["nodes"].empty())
                    throw std::runtime_error("GLB has no scene");
                graphs[id] = g;
            }
        std::map<std::string, size_t> indexes;
        for (const auto& n : scene["nodes"])
            if (included.count(n["id"].get<std::string>()))
            {
                auto id     = n["id"].get<std::string>();
                indexes[id] = j["nodes"].size();
                j["nodes"].push_back(
                  {{"name", n["name"]},
                   {"translation", n["transform"]["position"]},
                   {"rotation", n["transform"]["rotation"]},
                   {"scale", n["transform"]["scale"]},
                   {"children", Json::array()},
                   {"extras",
                    {{"novaEditor",
                      {{"id", id}, {"hidden", n.value("hidden", false)}, {"locked", n.value("locked", false)}}}}}});
            }
        for (const auto& n : scene["nodes"])
        {
            auto id = n["id"].get<std::string>();
            if (!included.count(id))
                continue;
            auto index = indexes.at(id);
            if (!n["parentId"].is_null() && indexes.count(n["parentId"].get<std::string>()))
                j["nodes"][indexes.at(n["parentId"].get<std::string>())]["children"].push_back(index);
            else
                j["scenes"][0]["nodes"].push_back(index);
            if (!content.count(id))
                continue;
            if (n.contains("camera"))
            {
                const auto& c               = n["camera"];
                j["nodes"][index]["camera"] = j["cameras"].size();
                if (c["projection"] == "orthographic")
                    j["cameras"].push_back(
                      {{"type", "orthographic"},
                       {"orthographic",
                        {{"xmag", c["orthographicSize"].get<double>() / 2},
                         {"ymag", c["orthographicSize"].get<double>() / 2},
                         {"znear", c.value("nearPlane", .01)},
                         {"zfar", c.value("farPlane", 200.)}}}});
                else
                    j["cameras"].push_back(
                      {{"type", "perspective"},
                       {"perspective",
                        {{"yfov", c.value("verticalFov", 45.) * 3.141592653589793 / 180},
                         {"znear", c.value("nearPlane", .01)},
                         {"zfar", c.value("farPlane", 200.)}}}});
            }
            if (n.contains("light") && n["light"]["type"] != "rectangle")
            {
                auto l = n["light"];
                used.insert("KHR_lights_punctual");
                if (!j.contains("extensions"))
                    j["extensions"] = {{"KHR_lights_punctual", {{"lights", Json::array()}}}};
                auto& lights                    = j["extensions"]["KHR_lights_punctual"]["lights"];
                j["nodes"][index]["extensions"] = {{"KHR_lights_punctual", {{"light", lights.size()}}}};
                Json lamp                       = {
                  {"name", n["name"]},
                  {"type", l["type"]},
                  {"color", l["color"]},
                  {"intensity", l.value("active", false) ? l["intensity"].get<double>() : 0.},
                  {"extras", {{"novaEditor", l}}}};
                if (l.value("range", 0.) > 0)
                    lamp["range"] = l["range"];
                if (l["type"] == "spot")
                    lamp["spot"] = {
                      {"innerConeAngle", l.value("innerConeAngle", .35)},
                      {"outerConeAngle", l.value("outerConeAngle", .6)}};
                lights.push_back(lamp);
            }
            if (n.contains("assetId"))
            {
                auto aid    = n["assetId"].get<std::string>();
                const auto& g = graphs.at(aid);
                const auto instanceStart = j["nodes"].size();
                const auto delta = instanceStart - g.start;
                const auto skinBase = j["skins"].size();
                auto instanceNode = [&](size_t ref) {
                    if (ref >= g.end - g.start)
                        throw std::runtime_error("Invalid animation or skin node reference");
                    return instanceStart + ref;
                };
                Json copied = Json::array();
                for (auto i = g.start; i < g.end; ++i)
                {
                    auto c = j["nodes"][i];
                    for (auto& x : c["children"])
                        x = instanceNode(x.get<size_t>() - g.start);
                    if (c.contains("skin"))
                    {
                        const auto ref = c["skin"].get<size_t>();
                        if (ref >= g.skins.size())
                            throw std::runtime_error("Invalid skin reference");
                        c["skin"] = skinBase + ref;
                    }
                    if (c["children"].is_null())
                        c.erase("children");
                    copied.push_back(c);
                }
                for (auto& c : copied)
                    j["nodes"].push_back(c);
                for (auto skin : g.skins)
                {
                    for (auto& joint : skin.at("joints"))
                        joint = instanceNode(joint.get<size_t>());
                    if (skin.contains("skeleton"))
                        skin["skeleton"] = instanceNode(skin["skeleton"].get<size_t>());
                    j["skins"].push_back(std::move(skin));
                }
                for (auto clip : g.animations)
                {
                    for (auto& channel : clip.at("channels"))
                    {
                        auto& node = channel.at("target").at("node");
                        node = instanceNode(node.get<size_t>());
                    }
                    j["animations"].push_back(std::move(clip));
                }
                Json roots = Json::array();
                for (auto x : g.roots)
                    roots.push_back(x + delta);
                if (!scene["assets"][aid].value("sourceSpace", false))
                {
                    auto t = decodeModel(load(scene["assets"][aid]["path"].get<std::string>())).normalization;
                    auto i = j["nodes"].size();
                    j["nodes"].push_back(
                      {{"name", "Source normalization"},
                       {"translation", t["position"]},
                       {"rotation", t["rotation"]},
                       {"scale", t["scale"]},
                       {"children", roots}});
                    roots = Json::array({i});
                }
                for (auto x : roots)
                    j["nodes"][index]["children"].push_back(x);
            }
        }
        std::set<size_t> templates;
        for (const auto& [id, g] : graphs)
            for (auto i = g.start; i < g.end; ++i)
                templates.insert(i);
        std::map<size_t, size_t> map;
        Json                     final = Json::array();
        for (size_t i = 0; i < j["nodes"].size(); ++i)
            if (!templates.count(i))
            {
                map[i] = final.size();
                final.push_back(j["nodes"][i]);
            }
        j["nodes"] = final;
        for (auto& n : j["nodes"])
        {
            for (auto& x : n["children"])
                x = map.at(x.get<size_t>());
            if (n["children"].empty())
                n.erase("children");
        }
        for (auto& skin : j["skins"])
        {
            for (auto& joint : skin.at("joints"))
                joint = map.at(joint.get<size_t>());
            if (skin.contains("skeleton"))
                skin["skeleton"] = map.at(skin["skeleton"].get<size_t>());
        }
        for (auto& clip : j["animations"])
            for (auto& channel : clip.at("channels"))
            {
                auto& node = channel.at("target").at("node");
                node = map.at(node.get<size_t>());
            }
        if (j["skins"].empty()) j.erase("skins");
        if (j["animations"].empty()) j.erase("animations");
        for (auto& x : j["scenes"][0]["nodes"])
            x = map.at(x.get<size_t>());
        if (!used.empty())
            j["extensionsUsed"] = used;
        if (!required.empty())
            j["extensionsRequired"] = required;
        if (!bin.empty())
            j["buffers"] = Json::array({{{"byteLength", bin.size()}}});
        for (const auto& k : keys)
            if (j[k].empty())
                j.erase(k);
        return writeGLB({j, bin, {}});
    }
} // namespace editor::assets
