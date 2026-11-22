#pragma once
#include "Assets.hpp"
#include "Hierarchy.hpp"
namespace editor::assets
{
    inline GLB compactPart(GLB doc)
    {
        auto&      j               = doc.json;
        auto&      p               = j["meshes"][0]["primitives"][0];
        const auto sourceViews     = j.value("bufferViews", Json::array()),
                   sourceAccessors = j.value("accessors", Json::array()),
                   sourceImages = j.value("images", Json::array()), sourceTextures = j.value("textures", Json::array());
        std::map<size_t, size_t> views, accessors, images, textures;
        Bytes                    bin;
        for (auto field : {"bufferViews", "accessors", "images", "textures"})
            j[field] = Json::array();
        auto view = [&](size_t id) -> size_t {
            if (views.count(id))
                return views[id];
            auto   v     = sourceViews.at(id);
            size_t start = v.value("byteOffset", size_t(0)), length = v.at("byteLength");
            if (v.at("buffer") != 0 || start > doc.bin.size() || length > doc.bin.size() - start)
                throw std::runtime_error("Submesh buffer out of bounds");
            bin.resize((bin.size() + 3) / 4 * 4);
            auto offset = bin.size();
            bin.insert(bin.end(), doc.bin.begin() + start, doc.bin.begin() + start + length);
            v["byteOffset"] = offset;
            auto index      = j["bufferViews"].size();
            j["bufferViews"].push_back(v);
            views[id] = index;
            return index;
        };
        auto accessor = [&](size_t id) -> size_t {
            if (accessors.count(id))
                return accessors[id];
            auto a = sourceAccessors.at(id);
            if (a.contains("sparse"))
                throw std::runtime_error("Sparse submesh data unsupported");
            a["bufferView"] = view(a.at("bufferView").get<size_t>());
            auto index      = j["accessors"].size();
            j["accessors"].push_back(a);
            accessors[id] = index;
            return index;
        };
        for (auto& a : p["attributes"])
            a = accessor(a.get<size_t>());
        if (p.contains("indices"))
            p["indices"] = accessor(p["indices"].get<size_t>());
        std::function<void(Json&)> materialTextures = [&](Json& value) {
            for (auto it = value.begin(); it != value.end(); ++it)
            {
                auto& child = it.value();
                if (!child.is_object())
                    continue;
                auto key = it.key();
                if (key.size() >= 7 && key.substr(key.size() - 7) == "Texture" && child.contains("index"))
                {
                    size_t old = child["index"], index;
                    if (textures.count(old))
                        index = textures[old];
                    else
                    {
                        auto   t      = sourceTextures.at(old);
                        size_t source = t.at("source"), image;
                        if (images.count(source))
                            image = images[source];
                        else
                        {
                            auto img          = sourceImages.at(source);
                            img["bufferView"] = view(img.at("bufferView").get<size_t>());
                            image             = j["images"].size();
                            j["images"].push_back(img);
                            images[source] = image;
                        }
                        t["source"] = image;
                        index       = j["textures"].size();
                        j["textures"].push_back(t);
                        textures[old] = index;
                    }
                    child["index"] = index;
                }
                else
                    materialTextures(child);
            }
        };
        materialTextures(j["materials"][0]);
        j["buffers"] = Json::array({{{"byteLength", bin.size()}}});
        doc.bin      = std::move(bin);
        doc.extra.clear();
        return doc;
    }
    struct EditableModel
    {
        Json                         nodes = Json::array(), parts = Json::array(), normalization = identity();
        std::map<std::string, Bytes> files;
    };
    inline EditableModel decodeModel(const Bytes& bytes)
    {
        auto        doc = readGLB(bytes);
        const auto& j   = doc.json;
        if (!j.value("animations", Json::array()).empty() || !j.value("skins", Json::array()).empty())
            throw std::runtime_error("Cannot expand animated or skinned models");
        for (const auto& x : j.value("extensionsRequired", Json::array()))
            if (x != "KHR_materials_ior" && x != "KHR_materials_transmission" && x != "KHR_materials_volume" && x != "KHR_materials_clearcoat" && x != "KHR_materials_unlit" && x != "KHR_materials_pbrSpecularGlossiness" && x != "KHR_materials_sheen" && x != "KHR_materials_iridescence" && x != "KHR_materials_anisotropy" && x != "KHR_materials_specular" && x != "KHR_texture_transform")
                throw std::runtime_error("Unsupported required model extension");
        for (const auto& b : j.value("buffers", Json::array()))
            if (b.contains("uri"))
                throw std::runtime_error("Embedded buffers required");
        for (const auto& i : j.value("images", Json::array()))
            if (i.contains("uri"))
                throw std::runtime_error("Embedded textures required");
        EditableModel         result;
        std::set<size_t>      visited;
        std::array<double, 3> minimum{INFINITY, INFINITY, INFINITY}, maximum{-INFINITY, -INFINITY, -INFINITY};
        std::function<void(size_t, Json, Matrix)> visit = [&](size_t index, Json parent, Matrix world) {
            if (index >= j.at("nodes").size() || !visited.insert(index).second || result.nodes.size() >= 4096)
                throw std::runtime_error("Invalid, repeated or excessive model nodes");
            const auto& n = j["nodes"][index];
            if (n.contains("skin"))
                throw std::runtime_error("Skinned model nodes unsupported");
            if (n.contains("camera") || (n.contains("extensions") && n["extensions"].contains("KHR_lights_punctual")))
                throw std::runtime_error("Model cameras and lights not supported");
            Json t = identity();
            if (n.contains("matrix"))
            {
                const auto m = n["matrix"].get<Matrix>();
                for (double x : m)
                    if (!std::isfinite(x))
                        throw std::runtime_error("Invalid node matrix");
                if (std::abs(m[3]) + std::abs(m[7]) + std::abs(m[11]) + std::abs(m[15] - 1) > 1e-8)
                    throw std::runtime_error("Non-affine node matrix");
                t = decomposeTRS(m);
            }
            else
            {
                t["position"] = n.value("translation", Json::array({0, 0, 0}));
                t["rotation"] = n.value("rotation", Json::array({0, 0, 0, 1}));
                t["scale"]    = n.value("scale", Json::array({1, 1, 1}));
                auto check    = emptyScene();
                check["nodes"].push_back({{"id", "check"}, {"parentId", nullptr}, {"name", "check"}, {"transform", t}});
                validate(check);
                for (double s : t["scale"])
                    if (std::abs(s) < 1e-8)
                        throw std::runtime_error("Zero node scale");
            }
            auto key  = "node-" + std::to_string(index);
            auto next = multiply(world, localMatrix(t));
            result.nodes.push_back(
              {{"key", key},
               {"parent", parent},
               {"name", n.value("name", "Node " + std::to_string(index + 1))},
               {"transform", t}});
            if (n.contains("mesh"))
            {
                size_t      mi         = n["mesh"];
                const auto& mesh       = j.at("meshes").at(mi);
                const auto& primitives = mesh.at("primitives");
                if (primitives.empty())
                    throw std::runtime_error("Missing mesh primitives");
                for (size_t pi = 0; pi < primitives.size(); pi++)
                {
                    const auto& p = primitives[pi];
                    const int mode = p.value("mode", 4);
                    if (mode < 0 || mode > 6 || p.contains("targets") || p.contains("extensions"))
                        throw std::runtime_error("Only uncompressed static glTF primitives are supported");
                    auto material =
                      p.contains("material") ? j.at("materials").at(p["material"].get<size_t>()) : Json::object();
                    if (auto mode = material.value("alphaMode", "OPAQUE");
                        mode != "OPAQUE" && mode != "MASK" && mode != "BLEND")
                        throw std::runtime_error("Invalid material alpha mode");
                    const auto& a = j.at("accessors").at(p.at("attributes").at("POSITION").get<size_t>());
                    const auto& v = j.at("bufferViews").at(a.at("bufferView").get<size_t>());
                    if (
                      a.at("componentType") != 5126 || a.at("type") != "VEC3" || a.contains("sparse")
                      || v.at("buffer") != 0)
                        throw std::runtime_error("Invalid position accessor");
                    size_t count = a.at("count"), stride = v.value("byteStride", size_t(12)),
                           start = v.value("byteOffset", size_t(0)) + a.value("byteOffset", size_t(0));
                    if (
                      !count || stride < 12 || count > doc.bin.size() / 12 || start > doc.bin.size()
                      || (count - 1) > (doc.bin.size() - start) / stride)
                        throw std::runtime_error("Invalid position buffer");
                    size_t end = start + (count - 1) * stride + 12;
                    if (
                      end > doc.bin.size() || end > v.value("byteOffset", size_t(0)) + v.at("byteLength").get<size_t>())
                        throw std::runtime_error("Position buffer out of bounds");
                    for (size_t vi = 0; vi < count; vi++)
                    {
                        float pos[3];
                        std::memcpy(pos, doc.bin.data() + start + vi * stride, 12);
                        for (auto x : pos)
                            if (!std::isfinite(x))
                                throw std::runtime_error("Invalid model vertex");
                        for (int k = 0; k < 3; k++)
                        {
                            double x = next[12 + k];
                            for (int c = 0; c < 3; c++)
                                x += next[c * 4 + k] * pos[c];
                            minimum[k] = std::min(minimum[k], x);
                            maximum[k] = std::max(maximum[k], x);
                        }
                    }
                    auto part = "mesh-" + std::to_string(mi) + "-" + std::to_string(pi),
                         name = mesh.value("name", n.value("name", std::string("Mesh"))) + " / "
                                + std::to_string(pi + 1) + " / " + material.value("name", std::string("Material"));
                    if (!result.files.count(part))
                    {
                        auto out              = doc;
                        out.json["nodes"]     = Json::array({{{"mesh", 0}}});
                        out.json["scenes"]    = Json::array({{{"nodes", {0}}}});
                        out.json["scene"]     = 0;
                        auto primitive        = p;
                        primitive["material"] = 0;
                        out.json["meshes"]    = Json::array(
                          {{{"name", mesh.value("name", std::string("Mesh"))},
                               {"primitives", Json::array({primitive})}}});
                        out.json["materials"] = Json::array({material});
                        for (auto field : {"animations", "skins", "cameras", "extras"})
                            out.json.erase(field);
                        out.json["extras"] = {{"novaEditor", {{"version", 1}, {"modelPart", true}}}};
                        result.files[part] = writeGLB(compactPart(std::move(out)));
                        result.parts.push_back({{"key", part}, {"name", name}});
                    }
                    result.nodes.push_back(
                      {{"key", key + "-slot-" + std::to_string(pi)},
                       {"parent", key},
                       {"name", name},
                       {"transform", identity()},
                       {"part", part}});
                }
            }
            for (const auto& child : n.value("children", Json::array()))
                visit(child.get<size_t>(), key, next);
        };
        for (const auto& root : j.at("scenes").at(j.value("scene", size_t(0))).at("nodes"))
            visit(root.get<size_t>(), nullptr, localMatrix(identity()));
        if (result.parts.empty())
            throw std::runtime_error("No editable submeshes");
        size_t outputBytes = 0;
        for (const auto& [key, bytes] : result.files)
            outputBytes += bytes.size();
        if (result.nodes.size() > 4096 || outputBytes > 120 * 1024 * 1024)
            throw std::runtime_error("Expanded model exceeds 4096 nodes / 120 MiB budget");
        double half = 0;
        for (int k = 0; k < 3; k++)
            half = std::max(half, (maximum[k] - minimum[k]) * .5);
        if (!std::isfinite(half) || half < 1e-8)
            throw std::runtime_error("Invalid model bounds");
        for (int k = 0; k < 3; k++)
        {
            result.normalization["scale"][k]    = 1 / half;
            result.normalization["position"][k] = -(minimum[k] + maximum[k]) / (2 * half);
        }
        return result;
    }
    inline std::map<std::string, Bytes> expandModel(
      Json& scene, const std::string& id, const EditableModel& model, const std::function<std::string()>& allocate)
    {
        assertEditable(scene, {id});
        size_t root = 0;
        while (scene["nodes"][root]["id"] != id)
            root++;
        auto                               old    = scene["nodes"][root].value("assetId", std::string());
        bool                               source = old.empty() || scene["assets"][old].value("sourceSpace", false);
        std::map<std::string, Bytes>       files;
        std::map<std::string, std::string> parts, nodes;
        for (const auto& n : model.nodes)
            nodes[n["key"]] = allocate();
        for (const auto& p : model.parts)
        {
            auto aid = allocate(), path = "assets/" + allocate() + ".glb";
            parts[p["key"]]      = aid;
            scene["assets"][aid] = {{"path", path}, {"sourceSpace", true}, {"name", p["name"]}};
            files[path]          = model.files.at(p["key"].get<std::string>());
        }
        auto parent = id;
        if (!source)
        {
            parent = allocate();
            scene["nodes"].push_back(
              {{"id", parent}, {"parentId", id}, {"name", "Source normalization"}, {"transform", model.normalization}});
        }
        scene["nodes"][root].erase("assetId");
        for (const auto& n : model.nodes)
        {
            Json child = {
              {"id", nodes.at(n["key"])},
              {"parentId", n["parent"].is_null() ? parent : nodes.at(n["parent"])},
              {"name", n["name"]},
              {"transform", n["transform"]}};
            if (n.contains("part"))
                child["assetId"] = parts.at(n["part"]);
            scene["nodes"].push_back(child);
        }
        bool used = false;
        for (const auto& n : scene["nodes"])
            if (n.value("assetId", std::string()) == old)
                used = true;
        if (!old.empty() && !used)
            scene["assets"].erase(old);
        scene["schemaVersion"] = std::max(2, scene["schemaVersion"].get<int>());
        return files;
    }
} // namespace editor::assets
