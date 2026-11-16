#pragma once
#include "Scene.hpp"
#include <array>
#include <cstring>
#include <functional>
namespace editor::assets
{
    using Bytes = std::vector<unsigned char>;
    struct Parameter
    {
        std::string key, label;
        double      value, min = .001, max = 1000;
        bool        integer = false;
    };
    inline Parameter dimension(std::string key, std::string label, double value = 1)
    {
        return {key, label, value};
    }
    inline Parameter segments(std::string key, std::string label, double value, double min = 1, double max = 64)
    {
        return {key, label, value, min, max, true};
    }
    inline const std::map<std::string, std::vector<Parameter>>& primitives()
    {
        static const std::map<std::string, std::vector<Parameter>> catalog{
          {"box",
           {dimension("width", "Width"),
            dimension("height", "Height"),
            dimension("depth", "Depth"),
            segments("widthSegments", "Width segments", 1),
            segments("heightSegments", "Height segments", 1),
            segments("depthSegments", "Depth segments", 1)}},
          {"plane",
           {dimension("width", "Width", 2),
            dimension("depth", "Depth", 2),
            segments("widthSegments", "Width segments", 1),
            segments("depthSegments", "Depth segments", 1)}},
          {"sphere",
           {dimension("radius", "Radius"),
            segments("widthSegments", "Width segments", 32, 8, 128),
            segments("heightSegments", "Height segments", 16, 4)}},
          {"cylinder",
           {dimension("radius", "Bottom radius"),
            {"radiusTop", "Top radius", 1, 0, 1000, false},
            dimension("height", "Height", 2),
            segments("radialSegments", "Radial segments", 32, 3, 128),
            segments("heightSegments", "Height segments", 1)}},
          {"cone",
           {dimension("radius", "Radius"),
            dimension("height", "Height", 2),
            segments("radialSegments", "Radial segments", 32, 3, 128),
            segments("heightSegments", "Height segments", 1)}},
          {"torus",
           {dimension("radius", "Radius"),
            dimension("tube", "Tube", .25),
            segments("radialSegments", "Radial segments", 12, 3),
            segments("tubularSegments", "Tubular segments", 32, 3, 128)}}};
        return catalog;
    }
    inline Json defaultGeometry(const std::string& type)
    {
        Json p = Json::object();
        for (const auto& s : primitives().at(type))
            p[s.key] = s.value;
        return {{"type", type}, {"parameters", p}};
    }
    inline void validateGeometry(const Json& g)
    {
        if (
          !g.is_object() || !g.contains("type") || !g["type"].is_string()
          || !primitives().count(g["type"].get<std::string>()) || !g.contains("parameters")
          || !g["parameters"].is_object())
            throw std::runtime_error("Invalid geometry type");
        const auto& specs = primitives().at(g["type"].get<std::string>());
        const auto& p     = g["parameters"];
        if (p.size() != specs.size())
            throw std::runtime_error("Incomplete geometry parameters");
        for (const auto& spec : specs)
        {
            if (!p.contains(spec.key) || !p[spec.key].is_number())
                throw std::runtime_error("Invalid geometry parameter");
            auto v = p[spec.key].get<double>();
            if (!std::isfinite(v) || v < spec.min || v > spec.max || (spec.integer && std::floor(v) != v))
                throw std::runtime_error("Out of range: " + spec.label);
        }
        if (g["type"] == "torus" && p["tube"].get<double>() >= p["radius"].get<double>())
            throw std::runtime_error("Tube radius must be smaller than ring radius");
    }
    inline uint32_t u32(const Bytes& b, size_t p)
    {
        if (p + 4 > b.size())
            throw std::runtime_error("GLB chunk overflow");
        return uint32_t(b[p]) | (uint32_t(b[p + 1]) << 8) | (uint32_t(b[p + 2]) << 16) | (uint32_t(b[p + 3]) << 24);
    }
    inline void put32(Bytes& b, size_t p, uint32_t v)
    {
        for (int i = 0; i < 4; i++)
            b.at(p + i) = static_cast<unsigned char>(v >> (8 * i));
    }
    constexpr uint32_t jsonChunk = 0x4e4f534a, binChunk = 0x004e4942;
    constexpr size_t   maxBytes = 128 * 1024 * 1024;
    struct Chunk
    {
        uint32_t type;
        Bytes    data;
    };
    struct GLB
    {
        Json               json;
        Bytes              bin;
        std::vector<Chunk> extra;
    };
    inline Bytes readBytes(const std::filesystem::path& path)
    {
        std::ifstream f(path, std::ios::binary | std::ios::ate);
        if (!f)
            throw std::runtime_error("Cannot open asset");
        auto size = f.tellg();
        if (size < 0 || size > std::streamoff(maxBytes))
            throw std::runtime_error("Asset exceeds 128 MiB");
        Bytes bytes(static_cast<size_t>(size));
        f.seekg(0);
        if (!f.read(reinterpret_cast<char*>(bytes.data()), size))
            throw std::runtime_error("Cannot read asset");
        return bytes;
    }
    inline GLB readGLB(const Bytes& b)
    {
        if (b.size() < 20 || b.size() > maxBytes || u32(b, 0) != 0x46546c67 || u32(b, 4) != 2 || u32(b, 8) != b.size())
            throw std::runtime_error("Invalid GLB header");
        GLB  doc;
        bool jsonSeen = false, binSeen = false;
        for (size_t offset = 12; offset < b.size();)
        {
            auto length = u32(b, offset), type = u32(b, offset + 4);
            offset += 8;
            if (length % 4 || offset + length > b.size())
                throw std::runtime_error("Invalid GLB chunk");
            Bytes data(b.begin() + offset, b.begin() + offset + length);
            if (type == jsonChunk)
            {
                if (jsonSeen || offset != 20)
                    throw std::runtime_error("Invalid GLB JSON order");
                doc.json = Json::parse(data);
                jsonSeen = true;
            }
            else if (type == binChunk)
            {
                if (binSeen)
                    throw std::runtime_error("Duplicate BIN");
                doc.bin = data;
                binSeen = true;
            }
            else
                doc.extra.push_back({type, data});
            offset += length;
        }
        if (!jsonSeen || doc.json.at("asset").value("version", "") != "2.0")
            throw std::runtime_error("GLB 2.0 required");
        if (doc.json.contains("buffers"))
        {
            if (doc.json["buffers"].size() > 1)
                throw std::runtime_error("One embedded buffer required");
            for (const auto& buffer : doc.json["buffers"])
                if (buffer.contains("uri") || buffer.at("byteLength").get<size_t>() > doc.bin.size())
                    throw std::runtime_error("Missing embedded GLB data");
        }
        return doc;
    }
    inline Bytes writeGLB(const GLB& doc)
    {
        auto               text = doc.json.dump();
        std::vector<Chunk> chunks{{jsonChunk, Bytes(text.begin(), text.end())}};
        if (!doc.bin.empty())
            chunks.push_back({binChunk, doc.bin});
        chunks.insert(chunks.end(), doc.extra.begin(), doc.extra.end());
        size_t size = 12;
        for (const auto& c : chunks)
            size += 8 + (c.data.size() + 3) / 4 * 4;
        if (size > maxBytes)
            throw std::runtime_error("GLB exceeds 128 MiB");
        Bytes out(size);
        put32(out, 0, 0x46546c67);
        put32(out, 4, 2);
        put32(out, 8, uint32_t(size));
        size_t at = 12;
        for (const auto& c : chunks)
        {
            size_t padded = (c.data.size() + 3) / 4 * 4;
            put32(out, at, uint32_t(padded));
            put32(out, at + 4, c.type);
            if (c.type == jsonChunk)
                std::fill(out.begin() + at + 8, out.begin() + at + 8 + padded, 32);
            std::copy(c.data.begin(), c.data.end(), out.begin() + at + 8);
            at += 8 + padded;
        }
        return out;
    }
    using V3 = std::array<double, 3>;
    struct Vertex
    {
        V3                    p, n;
        std::array<double, 2> uv;
    };
    inline double dot(V3 a, V3 b)
    {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }
    inline V3 sub(V3 a, V3 b)
    {
        for (int i = 0; i < 3; i++)
            a[i] -= b[i];
        return a;
    }
    inline V3 cross(V3 a, V3 b)
    {
        return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
    }
    inline std::vector<float> geometryVertices(const Json& g)
    {
        validateGeometry(g);
        const auto         type = g["type"].get<std::string>();
        const auto&        p    = g["parameters"];
        auto               val  = [&](const char* key) { return p.at(key).get<double>(); };
        std::vector<float> out;
        auto               tri = [&](Vertex a, Vertex b, Vertex c) {
            auto normal = cross(sub(b.p, a.p), sub(c.p, a.p));
            if (dot(normal, normal) < 1e-24)
                return;
            V3 average;
            for (int k = 0; k < 3; k++)
                average[k] = a.n[k] + b.n[k] + c.n[k];
            if (dot(normal, average) < 0)
                std::swap(b, c);
            for (const auto& v : {a, b, c})
            {
                for (auto x : v.p)
                    out.push_back(float(x));
                for (auto x : v.n)
                    out.push_back(float(x));
                for (auto x : v.uv)
                    out.push_back(float(x));
            }
        };
        auto grid = [&](int nx, int ny, const std::function<Vertex(double, double)>& at) {
            for (int y = 0; y < ny; y++)
                for (int x = 0; x < nx; x++)
                {
                    auto a = at(double(x) / nx, double(y) / ny), b = at(double(x + 1) / nx, double(y) / ny),
                         c = at(double(x + 1) / nx, double(y + 1) / ny), d = at(double(x) / nx, double(y + 1) / ny);
                    tri(a, b, c);
                    tri(a, c, d);
                }
        };
        constexpr double pi = 3.14159265358979323846;
        if (type == "box")
        {
            V3 dims{val("width"), val("height"), val("depth")},
              segs{val("widthSegments"), val("heightSegments"), val("depthSegments")};
            for (int axis = 0; axis < 3; axis++)
                for (int sign : {-1, 1})
                {
                    int u = (axis + 1) % 3, v = (axis + 2) % 3;
                    grid(int(segs[u]), int(segs[v]), [&](double a, double b) {
                        V3 pos{}, n{};
                        pos[axis] = sign * dims[axis] / 2;
                        pos[u]    = (a - .5) * dims[u];
                        pos[v]    = (b - .5) * dims[v];
                        n[axis]   = sign;
                        return Vertex{pos, n, {a, b}};
                    });
                }
        }
        else if (type == "plane")
            grid(int(val("widthSegments")), int(val("depthSegments")), [&](double u, double v) {
                return Vertex{{(u - .5) * val("width"), 0, (v - .5) * val("depth")}, {0, 1, 0}, {u, v}};
            });
        else if (type == "sphere")
            grid(int(val("widthSegments")), int(val("heightSegments")), [&](double u, double v) {
                double a = u * pi * 2, b                                                         = v * pi;
                V3     n{std::sin(b) * std::cos(a), std::cos(b), std::sin(b) * std::sin(a)}, pos = n;
                for (auto& x : pos)
                    x *= val("radius");
                return Vertex{pos, n, {u, 1 - v}};
            });
        else if (type == "torus")
            grid(int(val("tubularSegments")), int(val("radialSegments")), [&](double u, double v) {
                double a = u * pi * 2, b = v * pi * 2, c = std::cos(b), sn = std::sin(b),
                       r = val("radius") + val("tube") * c;
                return Vertex{
                  {r * std::cos(a), val("tube") * sn, r * std::sin(a)}, {c * std::cos(a), sn, c * std::sin(a)}, {u, v}};
            });
        else
        {
            double bottom = val("radius"), top = type == "cone" ? 0 : val("radiusTop"), h = val("height"),
                   slope = (bottom - top) / h, len = std::hypot(1, slope);
            int radial = int(val("radialSegments"));
            grid(radial, int(val("heightSegments")), [&](double u, double v) {
                double a = u * pi * 2, r = bottom + (top - bottom) * v;
                return Vertex{
                  {r * std::cos(a), (v - .5) * h, r * std::sin(a)},
                  {std::cos(a) / len, slope / len, std::sin(a) / len},
                  {u, v}};
            });
            for (auto cap : {std::pair<double, double>{bottom, -1}, {top, 1}})
                if (cap.first > 0)
                    for (int x = 0; x < radial; x++)
                    {
                        auto at = [&](double u) {
                            double a = u * pi * 2;
                            return Vertex{
                              {cap.first * std::cos(a), cap.second * h / 2, cap.first * std::sin(a)},
                              {0, cap.second, 0},
                              {.5 + .5 * std::cos(a), .5 + .5 * std::sin(a)}};
                        };
                        tri(
                          {{0, cap.second * h / 2, 0}, {0, cap.second, 0}, {.5, .5}},
                          at(double(x) / radial),
                          at(double(x + 1) / radial));
                    }
        }
        return out;
    }
    inline Bytes makePrimitive(const Json& g)
    {
        auto  data = geometryVertices(g);
        Bytes bin(data.size() * 4);
        V3    minimum{INFINITY, INFINITY, INFINITY}, maximum{-INFINITY, -INFINITY, -INFINITY};
        for (size_t i = 0; i < data.size(); i++)
        {
            uint32_t bits;
            std::memcpy(&bits, &data[i], 4);
            put32(bin, i * 4, bits);
            if (i % 8 < 3)
            {
                auto k     = i % 8;
                minimum[k] = std::min(minimum[k], double(data[i]));
                maximum[k] = std::max(maximum[k], double(data[i]));
            }
        }
        size_t count = data.size() / 8;
        Json   json  = {
          {"asset", {{"version", "2.0"}, {"generator", "Nova Editor primitives"}}},
          {"scene", 0},
          {"scenes", Json::array({{{"nodes", {0}}}})},
          {"nodes", Json::array({{{"mesh", 0}}})},
          {"meshes",
              Json::array(
             {{{"primitives", Json::array({{{"attributes", {{"POSITION", 0}, {"NORMAL", 1}, {"TEXCOORD_0", 2}}}, {"material", 0}}})}}})},
          {"materials",
              Json::array(
             {{{"name", "Material"},
                  {"pbrMetallicRoughness",
                   {{"baseColorFactor", {.5, .5, .5, 1}}, {"metallicFactor", 0}, {"roughnessFactor", .7}}}}})},
          {"buffers", Json::array({{{"byteLength", bin.size()}}})},
          {"bufferViews",
              Json::array(
             {{{"buffer", 0}, {"byteOffset", 0}, {"byteLength", bin.size()}, {"byteStride", 32}, {"target", 34962}}})},
          {"accessors",
              Json::array(
             {{{"bufferView", 0},
                  {"byteOffset", 0},
                  {"componentType", 5126},
                  {"count", count},
                  {"type", "VEC3"},
                  {"min", minimum},
                  {"max", maximum}},
                 {{"bufferView", 0}, {"byteOffset", 12}, {"componentType", 5126}, {"count", count}, {"type", "VEC3"}},
                 {{"bufferView", 0}, {"byteOffset", 24}, {"componentType", 5126}, {"count", count}, {"type", "VEC2"}}})},
          {"extras", {{"novaEditor", {{"version", 1}, {"geometry", g}}}}}};
        return writeGLB({json, bin, {}});
    }
    inline std::set<int> materialIds(const GLB& doc)
    {
        std::set<int> ids;
        for (const auto& mesh : doc.json.at("meshes"))
            for (const auto& p : mesh.at("primitives"))
                if (p.contains("material"))
                    ids.insert(p["material"].get<int>());
        if (ids.empty())
            throw std::runtime_error("Model has no material");
        return ids;
    }
    inline Json materialData(const GLB& doc)
    {
        const auto& m     = doc.json.at("materials").at(*materialIds(doc).begin());
        auto        p     = m.value("pbrMetallicRoughness", Json::object());
        auto        color = p.value("baseColorFactor", std::vector<double>{1, 1, 1, 1});
        if (color.size() != 4)
            throw std::runtime_error("Invalid color");
        return {
          {"name", m.value("name", std::string("Material"))},
          {"color", {color[0], color[1], color[2]}},
          {"metallic", p.value("metallicFactor", 1.)},
          {"roughness", p.value("roughnessFactor", 1.)},
          {"emissive", m.value("emissiveFactor", Json::array({0, 0, 0}))},
          {"normalScale", m.value("normalTexture", Json::object()).value("scale", 1.)},
          {"occlusion", m.value("occlusionTexture", Json::object()).value("strength", 1.)}};
    }
    inline GLB applyMaterial(GLB doc, const Json& v)
    {
        if (!v.at("name").is_string())
            throw std::runtime_error("Invalid material name");
        for (auto key : {"color", "emissive"})
        {
            if (!v.at(key).is_array() || v[key].size() != 3)
                throw std::runtime_error("Invalid material color");
            for (const auto& item : v[key])
            {
                double x = item.get<double>();
                if (!std::isfinite(x) || x < 0 || x > 1)
                    throw std::runtime_error("Invalid material color");
            }
        }
        for (auto key : {"metallic", "roughness", "normalScale", "occlusion"})
        {
            double x = v.at(key).get<double>();
            if (!std::isfinite(x) || x < 0 || x > (std::string(key) == "normalScale" ? 4 : 1))
                throw std::runtime_error("Invalid material factor");
        }
        for (int id : materialIds(doc))
        {
            auto& m              = doc.json["materials"][id];
            m["name"]            = v["name"];
            auto& p              = m["pbrMetallicRoughness"];
            p["baseColorFactor"] = {v["color"][0], v["color"][1], v["color"][2], 1};
            p["metallicFactor"]  = v["metallic"];
            p["roughnessFactor"] = v["roughness"];
            m["emissiveFactor"]  = v["emissive"];
            if (m.contains("normalTexture"))
                m["normalTexture"]["scale"] = v["normalScale"];
            if (m.contains("occlusionTexture"))
                m["occlusionTexture"]["strength"] = v["occlusion"];
        }
        return doc;
    }
    inline const std::array<std::string, 5> textureSlots{
      "baseColor", "normal", "metallicRoughness", "occlusion", "emissive"};
    inline std::pair<Json*, std::string> textureParent(Json& m, const std::string& slot)
    {
        if (std::find(textureSlots.begin(), textureSlots.end(), slot) == textureSlots.end())
            throw std::runtime_error("Unknown texture slot");
        if (slot == "baseColor" || slot == "metallicRoughness")
            return {&m["pbrMetallicRoughness"], slot + "Texture"};
        return {&m, slot + "Texture"};
    }
    inline bool hasTexture(const GLB& doc, const std::string& slot)
    {
        if (std::find(textureSlots.begin(), textureSlots.end(), slot) == textureSlots.end())
            throw std::runtime_error("Unknown texture slot");
        const auto& material = doc.json.at("materials").at(*materialIds(doc).begin());
        if (slot == "baseColor" || slot == "metallicRoughness")
            return material.contains("pbrMetallicRoughness")
                   && material["pbrMetallicRoughness"].contains(slot + "Texture");
        return material.contains(slot + "Texture");
    }
    inline std::string imageType(const Bytes& b)
    {
        if (b.size() < 4 || b.size() > 16 * 1024 * 1024)
            throw std::runtime_error("Texture must be below 16 MiB");
        if (b[0] == 137 && b[1] == 80 && b[2] == 78 && b[3] == 71)
            return "image/png";
        if (b[0] == 255 && b[1] == 216 && b[2] == 255)
            return "image/jpeg";
        throw std::runtime_error("PNG / JPEG required");
    }
    inline size_t appendBin(GLB& doc, const Bytes& data)
    {
        size_t at = (doc.bin.size() + 3) / 4 * 4;
        if (at + data.size() > maxBytes)
            throw std::runtime_error("GLB exceeds 128 MiB");
        doc.bin.resize(at);
        doc.bin.insert(doc.bin.end(), data.begin(), data.end());
        doc.json["buffers"] = Json::array({{{"byteLength", doc.bin.size()}}});
        return at;
    }
    inline GLB applyTexture(GLB doc, const std::string& slot, const std::optional<Bytes>& bytes)
    {
        int index = -1;
        if (bytes)
        {
            for (const auto& mesh : doc.json["meshes"])
                for (const auto& p : mesh["primitives"])
                    if (!p["attributes"].contains("TEXCOORD_0"))
                        throw std::runtime_error("Model needs UVs for textures");
            auto mime   = imageType(*bytes);
            auto at     = appendBin(doc, *bytes);
            auto ensure = [&](const char* k) {
                if (!doc.json.contains(k))
                    doc.json[k] = Json::array();
            };
            ensure("bufferViews");
            ensure("images");
            ensure("textures");
            int view = int(doc.json["bufferViews"].size());
            doc.json["bufferViews"].push_back({{"buffer", 0}, {"byteOffset", at}, {"byteLength", bytes->size()}});
            int image = int(doc.json["images"].size());
            doc.json["images"].push_back({{"bufferView", view}, {"mimeType", mime}});
            index = int(doc.json["textures"].size());
            doc.json["textures"].push_back({{"source", image}});
        }
        for (int id : materialIds(doc))
        {
            auto parent = textureParent(doc.json["materials"][id], slot);
            if (index < 0)
                parent.first->erase(parent.second);
            else
            {
                auto& t       = (*parent.first)[parent.second];
                t["index"]    = index;
                t["texCoord"] = 0;
            }
        }
        return doc;
    }
    inline std::optional<Json> geometryData(const GLB& doc)
    {
        if (!doc.json.contains("extras"))
            return {};
        auto meta = doc.json["extras"].value("novaEditor", Json::object());
        if (meta.value("version", 0) != 1 || !meta.contains("geometry"))
            return {};
        validateGeometry(meta["geometry"]);
        return meta["geometry"];
    }
    inline GLB regenerateGeometry(const GLB& doc, const Json& g)
    {
        if (!geometryData(doc))
            throw std::runtime_error("Imported geometry has no editable parameters");
        auto next              = readGLB(makePrimitive(g));
        next.json["materials"] = doc.json.at("materials");
        next.json["textures"]  = doc.json.value("textures", Json::array());
        next.json["samplers"]  = doc.json.value("samplers", Json::array());
        next.json["images"]    = Json::array();
        for (auto image : doc.json.value("images", Json::array()))
        {
            const auto& view   = doc.json.at("bufferViews").at(image.at("bufferView").get<size_t>());
            size_t      offset = view.value("byteOffset", size_t(0)), length = view.at("byteLength").get<size_t>();
            if (offset > doc.bin.size() || length > doc.bin.size() - offset)
                throw std::runtime_error("Corrupt image data");
            Bytes  data(doc.bin.begin() + offset, doc.bin.begin() + offset + length);
            auto   at = appendBin(next, data);
            size_t id = next.json["bufferViews"].size();
            next.json["bufferViews"].push_back({{"buffer", 0}, {"byteOffset", at}, {"byteLength", length}});
            image["bufferView"] = id;
            next.json["images"].push_back(image);
        }
        return next;
    }
    inline double groundOffset(const Json& g)
    {
        auto        type = g["type"].get<std::string>();
        const auto& p    = g["parameters"];
        return type == "plane"    ? 0
               : type == "sphere" ? p["radius"].get<double>()
               : type == "torus"  ? p["tube"].get<double>()
                                  : p["height"].get<double>() / 2;
    }
    inline float linearToSRGB(double c)
    {
        c = std::clamp(c, 0., 1.);
        return float(c <= .0031308 ? 12.92 * c : 1.055 * std::pow(c, 1 / 2.4) - .055);
    }
    inline double srgbToLinear(float c)
    {
        return c <= .04045 ? c / 12.92 : std::pow((c + .055) / 1.055, 2.4);
    }
} // namespace editor::assets
