#pragma once
#include "ConvertGLTF.hpp"
#include "MeshFormats.hpp"

namespace editor::assets
{
    inline std::string trimObj(std::string value)
    {
        const auto first = value.find_first_not_of(" \t\r");
        return first == std::string::npos ? "" : value.substr(first, value.find_last_not_of(" \t\r") - first + 1);
    }
    inline std::vector<std::pair<std::string, std::string>> objRows(const Bytes& bytes)
    {
        auto text = std::string(bytes.begin(), bytes.end());
        if (text.compare(0, 3, "\xef\xbb\xbf") == 0)
            text.erase(0, 3);
        std::istringstream                               stream(text);
        std::vector<std::pair<std::string, std::string>> result;
        for (std::string line; std::getline(stream, line);)
        {
            if (!line.empty() && line.back() == '\r')
                line.pop_back();
            while (!line.empty() && line.back() == '\\')
            {
                line.back() = ' ';
                std::string next;
                if (!std::getline(stream, next))
                    throw std::runtime_error("Incomplete OBJ line");
                if (!next.empty() && next.back() == '\r')
                    next.pop_back();
                line += next;
            }
            line = trimObj(line);
            if (line.compare(0, 7, "# nova_") == 0)
                line.erase(0, 2);
            else
                line = trimObj(line.substr(0, line.find('#')));
            auto space = line.find_first_of(" \t");
            result.emplace_back(
              line.substr(0, space), space == std::string::npos ? "" : trimObj(line.substr(space + 1)));
        }
        return result;
    }
    inline std::string objResource(std::string value)
    {
        if (value.size() >= 2 && value.front() == '"' && value.back() == '"')
            value = value.substr(1, value.size() - 2);
        return modelResourcePath(value);
    }
    inline std::vector<float> objNumbers(const std::string& text, size_t count)
    {
        std::istringstream in(text);
        in.imbue(std::locale::classic());
        std::vector<float> result(count);
        for (auto& value : result)
            if (!(in >> value) || !std::isfinite(value))
                throw std::runtime_error("Invalid OBJ / MTL number");
        return result;
    }
    inline Bytes objToGLB(const Bytes& source, const std::function<Bytes(const std::string&)>& load)
    {
        std::vector<MeshPoint>            positions, normals;
        std::vector<std::array<float, 2>> uvs;
        auto                              materials = Json::array(
          {{{"name", "Default"}, {"pbrMetallicRoughness", {{"metallicFactor", 0}, {"roughnessFactor", .8}}}}});
        auto views = Json::array(), accessors = Json::array(), textures = Json::array(), images = Json::array();
        std::map<std::string, size_t> names, imageIds;
        Bytes                         bin;
        const auto                    append = [&](const Bytes& bytes) {
            const auto offset = (bin.size() + 3) & ~size_t(3);
            if (bytes.size() > maxBytes || offset > maxBytes - bytes.size())
                throw std::runtime_error("Model exceeds 128 MiB");
            bin.resize(offset);
            bin.insert(bin.end(), bytes.begin(), bytes.end());
            views.push_back({{"buffer", 0}, {"byteOffset", offset}, {"byteLength", bytes.size()}});
            return views.size() - 1;
        };
        const auto texture = [&](const std::string& path) -> Json {
            if (const auto found = imageIds.find(path); found != imageIds.end())
                return {{"index", found->second}};
            auto ext = std::filesystem::path(path).extension().string();
            std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return std::tolower(c); });
            const auto mime = ext == ".png" ? "image/png" : ext == ".jpg" || ext == ".jpeg" ? "image/jpeg" : nullptr;
            if (!mime)
                throw std::runtime_error("OBJ textures require PNG or JPEG");
            const auto bytes = load(path);
            if (bytes.empty())
                throw std::runtime_error("Missing texture: " + path);
            const auto index = textures.size();
            textures.push_back({{"source", images.size()}});
            images.push_back({{"bufferView", append(bytes)}, {"mimeType", mime}});
            imageIds[path] = index;
            return {{"index", index}};
        };
        const auto rows  = objRows(source);
        const auto clamp = [](float n) { return std::clamp(n, 0.f, 1.f); };
        for (const auto& [tag, value] : rows)
            if (tag == "mtllib")
            {
                const auto path   = objResource(value);
                const auto prefix = path.substr(0, path.find_last_of('/') + 1);
                size_t     slot   = 0;
                for (const auto& [key, v] : objRows(load(path)))
                {
                    if (key == "newmtl")
                    {
                        slot     = materials.size();
                        names[v] = slot;
                        materials.push_back(
                          {{"name", v},
                           {"pbrMetallicRoughness",
                            {{"baseColorFactor", {1, 1, 1, 1}}, {"metallicFactor", 0}, {"roughnessFactor", .8}}}});
                        continue;
                    }
                    if (!slot)
                        continue;
                    auto& m = materials[slot];
                    auto& p = m["pbrMetallicRoughness"];
                    if (key == "Kd" || key == "Ke")
                    {
                        auto rgb = objNumbers(v, 3);
                        for (auto& n : rgb)
                            n = clamp(n);
                        if (key == "Ke")
                            m["emissiveFactor"] = rgb;
                        else
                            for (size_t k = 0; k < 3; ++k)
                                p["baseColorFactor"][k] = rgb[k];
                    }
                    if (key == "d" || key == "Tr")
                    {
                        auto a                  = clamp(objNumbers(v, 1)[0]);
                        p["baseColorFactor"][3] = key == "Tr" ? 1 - a : a;
                    }
                    if (key == "Pm")
                        p["metallicFactor"] = clamp(objNumbers(v, 1)[0]);
                    if (key == "Pr")
                        p["roughnessFactor"] = clamp(objNumbers(v, 1)[0]);
                    if (key == "Ns")
                        p["roughnessFactor"] = std::sqrt(2 / (std::max(0.f, objNumbers(v, 1)[0]) + 2));
                    if (key == "nova_map_orm")
                        p["metallicRoughnessTexture"] = texture(prefix + objResource(v));
                    if (key == "nova_map_ao")
                        m["occlusionTexture"] = texture(prefix + objResource(v));
                    if (key == "nova_alpha" && (v == "OPAQUE" || v == "MASK" || v == "BLEND"))
                        m["alphaMode"] = v;
                    if (key == "nova_cutoff")
                        m["alphaCutoff"] = clamp(objNumbers(v, 1)[0]);
                    if (key == "nova_double_sided")
                        m["doubleSided"] = v == "1";
                    if (key == "nova_normal_scale" && m.contains("normalTexture"))
                        m["normalTexture"]["scale"] = objNumbers(v, 1)[0];
                    if (key == "nova_occlusion_strength" && m.contains("occlusionTexture"))
                        m["occlusionTexture"]["strength"] = clamp(objNumbers(v, 1)[0]);
                    if (key == "map_Kd" || key == "map_Ke" || key == "norm" || key == "map_Bump" || key == "bump")
                    {
                        if (!v.empty() && v[0] == '-')
                            throw std::runtime_error("MTL map options are unsupported");
                        auto info = texture(prefix + objResource(v));
                        if (key == "map_Kd")
                            p["baseColorTexture"] = std::move(info);
                        else
                            m[key == "map_Ke" ? "emissiveTexture" : "normalTexture"] = std::move(info);
                    }
                }
            }
        for (auto& m : materials)
        {
            auto& p = m["pbrMetallicRoughness"];
            if (!m.contains("alphaMode") && p.contains("baseColorFactor") && p["baseColorFactor"][3].get<float>() < 1)
                m["alphaMode"] = "BLEND";
            if (m.contains("emissiveTexture") && !m.contains("emissiveFactor"))
                m["emissiveFactor"] = {1, 1, 1};
        }
        const auto resolve = [](const std::string& s, size_t size) {
            size_t     used   = 0;
            const auto index  = std::stoll(s, &used);
            const auto offset = index < 0 ? static_cast<long long>(size) + index : index - 1;
            if (!index || used != s.size() || offset < 0 || static_cast<size_t>(offset) >= size)
                throw std::runtime_error("OBJ index out of range");
            return static_cast<size_t>(offset);
        };
        struct InputCorner
        {
            MeshPoint                           position;
            std::optional<MeshPoint>            normal;
            std::optional<std::array<float, 2>> uv;
        };
        std::map<size_t, std::vector<ObjCorner>> groups;
        size_t                                   slot = 0, total = 0;
        for (const auto& [tag, value] : rows)
        {
            if (tag == "v" || tag == "vn")
            {
                const auto p = objNumbers(value, 3);
                (tag == "v" ? positions : normals).push_back({p[0], p[1], p[2]});
            }
            if (tag == "vt")
            {
                const auto p = objNumbers(value, 2);
                uvs.push_back({p[0], 1 - p[1]});
            }
            if (tag == "usemtl")
            {
                if (!names.count(value))
                    throw std::runtime_error("Missing MTL material: " + value);
                slot = names.at(value);
            }
            if (tag != "f")
                continue;
            std::istringstream       in(value);
            std::vector<InputCorner> corners;
            std::vector<MeshPoint>   points;
            for (std::string token; in >> token;)
            {
                const auto first  = token.find('/'),
                           second = first == std::string::npos ? first : token.find('/', first + 1);
                InputCorner corner{positions.at(resolve(token.substr(0, first), positions.size())), {}, {}};
                if (first != std::string::npos)
                {
                    const auto uv = token.substr(first + 1, second == std::string::npos ? second : second - first - 1);
                    if (!uv.empty())
                        corner.uv = uvs.at(resolve(uv, uvs.size()));
                }
                if (second != std::string::npos && second + 1 < token.size())
                    corner.normal = normals.at(resolve(token.substr(second + 1), normals.size()));
                points.push_back(corner.position);
                corners.push_back(corner);
            }
            if (points.size() < 3)
                throw std::runtime_error("OBJ face requires at least three vertices");
            // Polygon vertices use unique positions. Triangulating repeated positions is ambiguous.
            if (points.size() > 3 && std::set<MeshPoint>(points.begin(), points.end()).size() != points.size())
                throw std::runtime_error("OBJ polygon repeats a position");
            auto& group = groups[slot];
            triangulateFace(points, [&](const MeshTriangle& triangle) {
                if (++total > maxMeshTriangles)
                    throw std::runtime_error("Mesh exceeds one million triangles");
                const auto fallback = meshNormal(triangle);
                for (size_t k = 0; k < 3; ++k)
                {
                    const auto at =
                      points.size() == 3
                        ? k
                        : static_cast<size_t>(std::find(points.begin(), points.end(), triangle[k]) - points.begin());
                    const auto& c = corners.at(at);
                    group.push_back({c.position, c.normal.value_or(fallback), c.uv});
                }
            });
        }
        if (!total)
            throw std::runtime_error("Model has no triangles");
        auto primitives = Json::array();
        for (const auto& [material, corners] : groups)
        {
            const auto& m = materials[material];
            const bool  hasUV =
              std::any_of(corners.begin(), corners.end(), [](const auto& c) { return c.uv.has_value(); });
            if (
              (m["pbrMetallicRoughness"].contains("baseColorTexture") || m.contains("normalTexture")
               || m.contains("emissiveTexture") || m.contains("occlusionTexture")
               || m["pbrMetallicRoughness"].contains("metallicRoughnessTexture"))
              && std::any_of(corners.begin(), corners.end(), [](const auto& c) { return !c.uv; }))
                throw std::runtime_error("Textured OBJ face is missing UV");
            const size_t stride = hasUV ? 32 : 24;
            Bytes        bytes(corners.size() * stride);
            MeshPoint    min{}, max{};
            min.fill(std::numeric_limits<float>::infinity());
            max.fill(-std::numeric_limits<float>::infinity());
            for (size_t i = 0; i < corners.size(); ++i)
            {
                const auto& c = corners[i];
                for (size_t k = 0; k < 3; ++k)
                {
                    min[k] = std::min(min[k], c.position[k]);
                    max[k] = std::max(max[k], c.position[k]);
                    putMeshFloat(bytes, i * stride + k * 4, c.position[k]);
                    putMeshFloat(bytes, i * stride + 12 + k * 4, c.normal[k]);
                }
                if (hasUV)
                    for (size_t k = 0; k < 2; ++k)
                        putMeshFloat(bytes, i * stride + 24 + k * 4, c.uv ? (*c.uv)[k] : 0.f);
            }
            const auto view           = append(bytes);
            views[view]["byteStride"] = stride;
            views[view]["target"]     = 34962;
            const auto count          = corners.size();
            const auto accessor       = [&](const char* type, size_t offset) {
                const auto index = accessors.size();
                accessors.push_back(
                  {{"bufferView", view},
                   {"byteOffset", offset},
                   {"componentType", 5126},
                   {"count", count},
                   {"type", type}});
                return index;
            };
            const auto position        = accessor("VEC3", 0);
            accessors[position]["min"] = min;
            accessors[position]["max"] = max;
            Json attributes            = {{"POSITION", position}, {"NORMAL", accessor("VEC3", 12)}};
            if (hasUV)
                attributes["TEXCOORD_0"] = accessor("VEC2", 24);
            primitives.push_back({{"material", material}, {"attributes", attributes}});
        }
        Json doc = {
          {"asset", {{"version", "2.0"}}},
          {"scene", 0},
          {"scenes", Json::array({{{"nodes", {0}}}})},
          {"nodes", Json::array({{{"mesh", 0}}})},
          {"meshes", Json::array({{{"primitives", primitives}}})},
          {"materials", materials},
          {"bufferViews", views},
          {"accessors", accessors},
          {"buffers", Json::array({{{"byteLength", bin.size()}}})}};
        if (!images.empty())
        {
            doc["images"]   = images;
            doc["textures"] = textures;
        }
        return writeGLB({std::move(doc), std::move(bin), {}});
    }
    inline std::map<std::string, Bytes> glbToOBJ(const Bytes& bytes)
    {
        const auto                    glb   = readGLB(bytes);
        auto                          files = std::map<std::string, Bytes>{};
        std::map<int, std::string>    names;
        std::map<size_t, std::string> imageNames;
        std::ostringstream            obj, mtl;
        for (auto* stream : {&obj, &mtl})
        {
            stream->imbue(std::locale::classic());
            *stream << std::setprecision(std::numeric_limits<float>::max_digits10);
        }
        obj << "mtllib model.mtl\n";
        size_t      vertex = 0, uv = 0, normals = 0;
        std::string active;
        const auto  image = [&](const Json& info) {
            if (
              info.value("texCoord", 0) != 0
              || (info.contains("extensions") && info["extensions"].contains("KHR_texture_transform")))
                throw std::runtime_error("OBJ export requires untransformed TEXCOORD_0");
            const size_t id = glb.json.at("textures").at(info.at("index").get<size_t>()).at("source");
            if (imageNames.count(id))
                return imageNames.at(id);
            const auto& img   = glb.json.at("images").at(id);
            const auto& view  = glb.json.at("bufferViews").at(img.at("bufferView").get<size_t>());
            const auto  start = view.value("byteOffset", size_t(0)), len = view.at("byteLength").get<size_t>();
            const auto  mime      = img.value("mimeType", std::string{});
            const auto  extension = mime == "image/png" ? "png" : mime == "image/jpeg" ? "jpg" : nullptr;
            if (!extension || view.at("buffer") != 0 || start > glb.bin.size() || !len || len > glb.bin.size() - start)
                throw std::runtime_error("OBJ export requires embedded PNG or JPEG");
            const auto name = "texture-" + std::to_string(imageNames.size() + 1) + "." + extension;
            files[name]     = Bytes(glb.bin.begin() + start, glb.bin.begin() + start + len);
            imageNames[id]  = name;
            return name;
        };
        glbToMesh(bytes, false, [&](const ObjFace& face, int slot) {
            if (!names.count(slot))
            {
                auto name        = "material_" + std::to_string(names.size() + 1);
                names[slot]      = name;
                const auto m     = slot >= 0 ? glb.json.at("materials").at(slot) : Json::object();
                const auto p     = m.value("pbrMetallicRoughness", Json::object());
                const auto color = p.value("baseColorFactor", std::array<float, 4>{1, 1, 1, 1});
                mtl << "newmtl " << name << "\nKd " << color[0] << ' ' << color[1] << ' ' << color[2] << "\nd "
                    << color[3] << "\nPm " << p.value("metallicFactor", 1.f) << "\nPr "
                    << p.value("roughnessFactor", 1.f) << '\n';
                if (m.contains("emissiveFactor"))
                {
                    const auto e = m["emissiveFactor"].get<MeshPoint>();
                    mtl << "Ke " << e[0] << ' ' << e[1] << ' ' << e[2] << '\n';
                }
                if (p.contains("baseColorTexture"))
                    mtl << "map_Kd " << image(p["baseColorTexture"]) << '\n';
                if (m.contains("emissiveTexture"))
                    mtl << "map_Ke " << image(m["emissiveTexture"]) << '\n';
                if (m.contains("normalTexture"))
                    mtl << "norm " << image(m["normalTexture"]) << "\n# nova_normal_scale "
                        << m["normalTexture"].value("scale", 1.f) << '\n';
                if (p.contains("metallicRoughnessTexture"))
                    mtl << "# nova_map_orm " << image(p["metallicRoughnessTexture"]) << '\n';
                if (m.contains("occlusionTexture"))
                    mtl << "# nova_map_ao " << image(m["occlusionTexture"]) << "\n# nova_occlusion_strength "
                        << m["occlusionTexture"].value("strength", 1.f) << '\n';
                if (m.contains("alphaMode"))
                    mtl << "# nova_alpha " << m["alphaMode"].get<std::string>() << '\n';
                if (m.contains("alphaCutoff"))
                    mtl << "# nova_cutoff " << m["alphaCutoff"].get<float>() << '\n';
                if (m.value("doubleSided", false))
                    mtl << "# nova_double_sided 1\n";
                mtl << '\n';
            }
            const auto& name = names.at(slot);
            if (name != active)
            {
                obj << "usemtl " << name << '\n';
                active = name;
            }
            std::array<std::string, 3> indices;
            for (size_t k = 0; k < 3; ++k)
            {
                const auto& c = face[k];
                obj << "v " << c.position[0] << ' ' << c.position[1] << ' ' << c.position[2] << '\n';
                std::string t;
                if (c.uv)
                {
                    obj << "vt " << (*c.uv)[0] << ' ' << 1 - (*c.uv)[1] << '\n';
                    t = std::to_string(++uv);
                }
                obj << "vn " << c.normal[0] << ' ' << c.normal[1] << ' ' << c.normal[2] << '\n';
                indices[k] = std::to_string(++vertex) + "/" + t + "/" + std::to_string(++normals);
            }
            obj << "f " << indices[0] << ' ' << indices[1] << ' ' << indices[2] << '\n';
        });
        const auto geometry = obj.str(), materials = mtl.str();
        if (geometry.size() > maxBytes)
            throw std::runtime_error("OBJ exceeds 128 MiB");
        files["model.obj"] = Bytes(geometry.begin(), geometry.end());
        files["model.mtl"] = Bytes(materials.begin(), materials.end());
        return files;
    }
} // namespace editor::assets
