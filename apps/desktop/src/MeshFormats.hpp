#pragma once
#include "Assets.hpp"
#include "Transforms.hpp"
#include <iomanip>
#include <locale>
#include <sstream>

namespace editor::assets
{
    using MeshPoint                   = std::array<float, 3>;
    using MeshTriangle                = std::array<MeshPoint, 3>;
    constexpr size_t maxMeshTriangles = 1000000;

    inline MeshPoint meshNormal(const MeshTriangle& triangle)
    {
        std::array<double, 3> a{}, b{};
        for (size_t i = 0; i < 3; ++i)
        {
            a[i] = double(triangle[1][i]) - triangle[0][i];
            b[i] = double(triangle[2][i]) - triangle[0][i];
        }
        const std::array<double, 3> n{a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
        const auto                  length = std::hypot(n[0], n[1], n[2]);
        if (!length)
            return {0, 1, 0};
        return {float(n[0] / length), float(n[1] / length), float(n[2] / length)};
    }
    inline float meshFloat(const Bytes& bytes, size_t offset)
    {
        const auto bits = u32(bytes, offset);
        float      value;
        std::memcpy(&value, &bits, 4);
        if (!std::isfinite(value))
            throw std::runtime_error("Invalid mesh coordinate");
        return value;
    }
    inline void putMeshFloat(Bytes& bytes, size_t offset, float value)
    {
        uint32_t bits;
        std::memcpy(&bits, &value, 4);
        put32(bytes, offset, bits);
    }
    inline void triangulateFace(std::vector<MeshPoint> face, const std::function<void(MeshTriangle)>& add)
    {
        if (face.size() == 3)
        {
            add({face[0], face[1], face[2]});
            return;
        }
        if (face.size() > 1024)
            throw std::runtime_error("OBJ polygon exceeds 1024 vertices");
        std::array<double, 3> normal{};
        for (size_t i = 0; i < face.size(); ++i)
        {
            const auto& a = face[i];
            const auto& b = face[(i + 1) % face.size()];
            for (size_t k = 0; k < 3; ++k)
                normal[k] += (double(a[(k + 1) % 3]) - b[(k + 1) % 3]) * (double(a[(k + 2) % 3]) + b[(k + 2) % 3]);
        }
        size_t axis = 0;
        for (size_t k = 1; k < 3; ++k)
            if (std::abs(normal[k]) > std::abs(normal[axis]))
                axis = k;
        if (!normal[axis])
            throw std::runtime_error("Degenerate OBJ polygon");
        const auto   u = (axis + 1) % 3, v = (axis + 2) % 3;
        const double sign = normal[axis] > 0 ? 1 : -1;
        const auto   turn = [&](const MeshPoint& a, const MeshPoint& b, const MeshPoint& c) {
            return sign
                   * ((double(b[u]) - a[u]) * (double(c[v]) - a[v]) - (double(b[v]) - a[v]) * (double(c[u]) - a[u]));
        };
        while (face.size() > 3)
        {
            bool found = false;
            for (size_t i = 0; i < face.size(); ++i)
            {
                const auto& a = face[(i + face.size() - 1) % face.size()];
                const auto& b = face[i];
                const auto& c = face[(i + 1) % face.size()];
                if (turn(a, b, c) <= 0 || std::any_of(face.begin(), face.end(), [&](const MeshPoint& p) {
                        return &p != &a && &p != &b && &p != &c && turn(a, b, p) >= 0 && turn(b, c, p) >= 0
                               && turn(c, a, p) >= 0;
                    }))
                    continue;
                add({a, b, c});
                face.erase(face.begin() + i);
                found = true;
                break;
            }
            if (!found)
                throw std::runtime_error("Cannot triangulate OBJ polygon");
        }
        add({face[0], face[1], face[2]});
    }

    inline std::vector<MeshTriangle> parseMesh(const Bytes& bytes, bool stl)
    {
        std::vector<MeshTriangle> triangles;
        const auto                add = [&](MeshTriangle triangle) {
            if (triangles.size() >= maxMeshTriangles)
                throw std::runtime_error("Mesh exceeds one million triangles");
            triangles.push_back(triangle);
        };
        if (stl && bytes.size() >= 84 && 84 + uint64_t(u32(bytes, 80)) * 50 == bytes.size())
        {
            for (size_t i = 0; i < u32(bytes, 80); ++i)
            {
                MeshTriangle triangle{};
                for (size_t j = 0; j < 3; ++j)
                    for (size_t k = 0; k < 3; ++k)
                        triangle[j][k] = meshFloat(bytes, 96 + i * 50 + j * 12 + k * 4);
                add(triangle);
            }
            return triangles;
        }
        std::string text(bytes.begin(), bytes.end());
        if (text.compare(0, 3, "\xef\xbb\xbf") == 0)
            text.erase(0, 3);
        std::istringstream stream(text);
        stream.imbue(std::locale::classic());
        const auto readPoint = [](std::istream& in) {
            MeshPoint p{};
            for (auto& x : p)
                if (!(in >> x) || !std::isfinite(x))
                    throw std::runtime_error("Invalid mesh vertex");
            return p;
        };
        if (stl)
        {
            std::string tag, rest;
            auto        keyword = [&]() {
                std::string word;
                stream >> word;
                std::transform(word.begin(), word.end(), word.begin(), [](unsigned char c) { return std::tolower(c); });
                return word;
            };
            auto expect = [&](const char* word) {
                if (keyword() != word)
                    throw std::runtime_error(std::string("Expected STL keyword: ") + word);
            };
            while (!(tag = keyword()).empty())
            {
                if (tag != "solid")
                    throw std::runtime_error("Invalid ASCII STL");
                std::getline(stream, rest);
                while ((tag = keyword()) != "endsolid")
                {
                    if (tag != "facet")
                        throw std::runtime_error("Invalid STL facet");
                    expect("normal");
                    readPoint(stream);
                    expect("outer");
                    expect("loop");
                    MeshTriangle triangle{};
                    for (auto& p : triangle)
                    {
                        expect("vertex");
                        p = readPoint(stream);
                    }
                    expect("endloop");
                    expect("endfacet");
                    add(triangle);
                }
                std::getline(stream, rest);
            }
            return triangles;
        }
        std::vector<MeshPoint> points;
        std::string            line;
        while (std::getline(stream, line))
        {
            while (!line.empty() && (line.back() == '\r' || line.back() == ' ' || line.back() == '\t'))
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
            std::istringstream row(line.substr(0, line.find('#')));
            row.imbue(std::locale::classic());
            std::string tag;
            row >> tag;
            if (tag == "v")
                points.push_back(readPoint(row));
            if (tag != "f")
                continue;
            std::vector<size_t> face;
            for (std::string token; row >> token;)
            {
                const auto index = token.substr(0, token.find('/'));
                size_t     used  = 0;
                const auto raw   = std::stoll(index, &used);
                if (!raw)
                    throw std::runtime_error("OBJ indices start at 1");
                const auto offset = raw < 0 ? static_cast<long long>(points.size()) + raw : raw - 1;
                if (used != index.size() || offset < 0 || static_cast<size_t>(offset) >= points.size())
                    throw std::runtime_error("OBJ face index out of range");
                face.push_back(static_cast<size_t>(offset));
            }
            if (face.size() < 3)
                throw std::runtime_error("OBJ face requires three vertices");
            if (face.size() == 3)
                add({points[face[0]], points[face[1]], points[face[2]]});
            else
            {
                std::vector<MeshPoint> polygon;
                for (const auto index : face)
                    polygon.push_back(points[index]);
                triangulateFace(std::move(polygon), add);
            }
        }
        return triangles;
    }
    inline Bytes meshToGLB(const Bytes& bytes, bool stl)
    {
        const auto triangles = parseMesh(bytes, stl);
        if (triangles.empty())
            throw std::runtime_error("Model has no triangles");
        Bytes     bin(triangles.size() * 72);
        MeshPoint min{}, max{};
        min.fill(std::numeric_limits<float>::infinity());
        max.fill(-std::numeric_limits<float>::infinity());
        size_t offset = 0;
        for (const auto& triangle : triangles)
        {
            const auto normal = meshNormal(triangle);
            for (const auto& point : triangle)
            {
                for (size_t k = 0; k < 3; ++k)
                {
                    min[k] = std::min(min[k], point[k]);
                    max[k] = std::max(max[k], point[k]);
                    putMeshFloat(bin, offset + k * 4, point[k]);
                    putMeshFloat(bin, offset + 12 + k * 4, normal[k]);
                }
                offset += 24;
            }
        }
        const auto count = triangles.size() * 3;
        Json       json  = {
          {"asset", {{"version", "2.0"}, {"generator", "Nova Editor"}}},
          {"scene", 0},
          {"scenes", Json::array({{{"nodes", {0}}}})},
          {"nodes", Json::array({{{"mesh", 0}}})},
          {"meshes",
                  Json::array(
             {{{"primitives", Json::array({{{"attributes", {{"POSITION", 0}, {"NORMAL", 1}}}, {"material", 0}}})}}})},
          {"materials",
                  Json::array(
             {{{"name", "Default"}, {"pbrMetallicRoughness", {{"metallicFactor", 0}, {"roughnessFactor", .8}}}}})},
          {"accessors",
                  Json::array(
             {{{"bufferView", 0},
                      {"componentType", 5126},
                      {"count", count},
                      {"type", "VEC3"},
                      {"min", min},
                      {"max", max}},
                     {{"bufferView", 0}, {"byteOffset", 12}, {"componentType", 5126}, {"count", count}, {"type", "VEC3"}}})},
          {"buffers", Json::array({{{"byteLength", bin.size()}}})},
          {"bufferViews",
                  Json::array({{{"buffer", 0}, {"byteLength", bin.size()}, {"byteStride", 24}, {"target", 34962}}})}};
        return writeGLB({std::move(json), std::move(bin), {}});
    }
    struct ObjCorner
    {
        MeshPoint                           position, normal;
        std::optional<std::array<float, 2>> uv;
    };
    using ObjFace = std::array<ObjCorner, 3>;
    inline Bytes glbToMesh(const Bytes& bytes, bool stl, const std::function<void(const ObjFace&, int)>& onFace = {})
    {
        const auto  glb = readGLB(bytes);
        const auto& doc = glb.json;
        if (!doc.value("skins", Json::array()).empty() || !doc.value("animations", Json::array()).empty())
            throw std::runtime_error("OBJ/STL export requires static GLB");
        struct Accessor
        {
            size_t count, offset, stride, width;
        };
        const auto accessor = [&](size_t id, int components) -> Accessor {
            const auto&  a      = doc.at("accessors").at(id);
            const auto&  v      = doc.at("bufferViews").at(a.at("bufferView").get<size_t>());
            const auto   type   = a.at("componentType").get<int>();
            const size_t width  = components     ? 4 * components
                                  : type == 5121 ? 1
                                  : type == 5123 ? 2
                                  : type == 5125 ? 4
                                                 : 0;
            const auto   stride = v.value("byteStride", width), relative = a.value("byteOffset", size_t(0)),
                       offset = v.value("byteOffset", size_t(0)), extent = v.at("byteLength").get<size_t>(),
                       count = a.at("count").get<size_t>();
            const auto limit = std::min(glb.bin.size(), doc.at("buffers").at(0).at("byteLength").get<size_t>());
            if (
              !width || !count || stride < width || offset > limit || extent > limit - offset || relative > extent
              || width > extent - relative || (count - 1) > (extent - relative - width) / stride || a.contains("sparse")
              || v.at("buffer") != 0
              || (v.contains("extensions") && (v["extensions"].contains("EXT_meshopt_compression") || v["extensions"].contains("KHR_meshopt_compression")))
              || (components ? (a["type"] != (components == 2 ? "VEC2" : "VEC3") || type != 5126) : a["type"] != "SCALAR"))
                throw std::runtime_error("Unsupported or invalid GLB accessor");
            return {count, offset + relative, stride, width};
        };
        std::vector<MeshTriangle>                  triangles;
        std::set<size_t>                           active;
        std::function<void(size_t, const Matrix&)> visit = [&](size_t id, const Matrix& parent) {
            if (active.size() >= 256 || !active.insert(id).second)
                throw std::runtime_error("Invalid GLB hierarchy");
            const auto& node      = doc.at("nodes").at(id);
            const auto  transform = multiply(
              parent,
              node.contains("matrix") ? node["matrix"].get<Matrix>()
                                       : localMatrix(
                                          {{"position", node.value("translation", Json::array({0, 0, 0}))},
                                            {"rotation", node.value("rotation", Json::array({0, 0, 0, 1}))},
                                            {"scale", node.value("scale", Json::array({1, 1, 1}))}}));
            const auto determinant = transform[0] * (transform[5] * transform[10] - transform[9] * transform[6])
                                     - transform[4] * (transform[1] * transform[10] - transform[9] * transform[2])
                                     + transform[8] * (transform[1] * transform[6] - transform[5] * transform[2]);
            const bool mirrored = determinant < 0;
            if (node.contains("mesh"))
                for (const auto& p : doc.at("meshes").at(node["mesh"].get<size_t>()).at("primitives"))
                {
                    if (
                      p.value("mode", 4) != 4 || p.contains("targets")
                      || (p.contains("extensions") && p["extensions"].contains("KHR_draco_mesh_compression")))
                        throw std::runtime_error("Only static uncompressed triangle meshes are supported");
                    const auto positions = accessor(p.at("attributes").at("POSITION").get<size_t>(), 3);
                    const auto indices   = p.contains("indices")
                                             ? std::optional<Accessor>(accessor(p["indices"].get<size_t>(), 0))
                                             : std::nullopt;
                    const auto count     = indices ? indices->count : positions.count;
                    if (count % 3 || count / 3 > maxMeshTriangles - triangles.size())
                        throw std::runtime_error("Invalid or oversized mesh");
                    const auto vertexIndex = [&](size_t index) {
                        if (indices)
                        {
                            const auto offset = indices->offset + index * indices->stride;
                            index             = 0;
                            for (size_t k = 0; k < indices->width; ++k)
                                index |= size_t(glb.bin[offset + k]) << (k * 8);
                        }
                        return index;
                    };
                    const auto readVertex = [&](size_t index) {
                        index = vertexIndex(index);
                        if (index >= positions.count)
                            throw std::runtime_error("GLB index out of range");
                        const auto offset = positions.offset + index * positions.stride;
                        const auto x = meshFloat(glb.bin, offset), y = meshFloat(glb.bin, offset + 4),
                                   z = meshFloat(glb.bin, offset + 8);
                        MeshPoint result{};
                        for (size_t k = 0; k < 3; ++k)
                        {
                            result[k] =
                              transform[k] * x + transform[k + 4] * y + transform[k + 8] * z + transform[k + 12];
                            if (!std::isfinite(result[k]))
                                throw std::runtime_error("Invalid model transform");
                        }
                        return result;
                    };
                    const auto attribute = [&](const char* key, int components) -> std::optional<Accessor> {
                        if (!onFace || !p.at("attributes").contains(key))
                            return std::nullopt;
                        return accessor(p["attributes"][key].get<size_t>(), components);
                    };
                    const auto uv = attribute("TEXCOORD_0", 2), normals = attribute("NORMAL", 3);
                    for (size_t j = 0; j < count; j += 3)
                    {
                        const std::array<size_t, 3> order{j, j + (mirrored ? 2 : 1), j + (mirrored ? 1 : 2)};
                        const MeshTriangle triangle{readVertex(order[0]), readVertex(order[1]), readVertex(order[2])};
                        triangles.push_back(triangle);
                        if (!onFace)
                            continue;
                        ObjFace face{};
                        for (size_t k = 0; k < 3; ++k)
                        {
                            const auto index  = vertexIndex(order[k]);
                            auto&      corner = face[k];
                            corner.position   = triangle[k];
                            corner.normal     = meshNormal(triangle);
                            if (uv)
                            {
                                if (index >= uv->count)
                                    throw std::runtime_error("UV index out of range");
                                const auto pos = uv->offset + index * uv->stride;
                                corner.uv = std::array<float, 2>{meshFloat(glb.bin, pos), meshFloat(glb.bin, pos + 4)};
                            }
                            if (normals && determinant)
                            {
                                if (index >= normals->count)
                                    throw std::runtime_error("Normal index out of range");
                                const auto pos = normals->offset + index * normals->stride;
                                MeshPoint  transformed{};
                                for (size_t column = 0; column < 3; ++column)
                                {
                                    const auto a = ((column + 1) % 3) * 4, b = ((column + 2) % 3) * 4;
                                    const auto value = meshFloat(glb.bin, pos + column * 4);
                                    for (size_t row = 0; row < 3; ++row)
                                    {
                                        const auto u = (row + 1) % 3, v = (row + 2) % 3;
                                        transformed[row] +=
                                          (mirrored ? -1.f : 1.f) * value
                                          * (transform[a + u] * transform[b + v] - transform[a + v] * transform[b + u]);
                                    }
                                }
                                const auto len = std::hypot(transformed[0], transformed[1], transformed[2]);
                                if (len > 0 && std::isfinite(len))
                                    for (size_t row = 0; row < 3; ++row)
                                        corner.normal[row] = transformed[row] / len;
                            }
                        }
                        onFace(face, p.value("material", -1));
                    }
                }
            for (const auto& child : node.value("children", Json::array()))
                visit(child.get<size_t>(), transform);
            active.erase(id);
        };
        for (const auto& root : doc.at("scenes").at(doc.value("scene", size_t(0))).value("nodes", Json::array()))
            visit(root.get<size_t>(), localMatrix(identity()));
        if (triangles.empty())
            throw std::runtime_error("Model has no triangles");
        if (onFace)
            return {};
        if (!stl)
        {
            std::ostringstream out;
            out.imbue(std::locale::classic());
            out << std::setprecision(std::numeric_limits<float>::max_digits10) << "# Nova Editor\n";
            size_t index = 1;
            for (const auto& triangle : triangles)
            {
                for (const auto& p : triangle)
                    out << "v " << p[0] << ' ' << p[1] << ' ' << p[2] << '\n';
                out << "f " << index << ' ' << index + 1 << ' ' << index + 2 << '\n';
                index += 3;
            }
            const auto text = out.str();
            if (text.size() > maxBytes)
                throw std::runtime_error("OBJ exceeds 128 MiB");
            return Bytes(text.begin(), text.end());
        }
        Bytes             out(84 + triangles.size() * 50);
        const std::string title = "Nova Editor binary STL";
        std::copy(title.begin(), title.end(), out.begin());
        put32(out, 80, static_cast<uint32_t>(triangles.size()));
        for (size_t i = 0; i < triangles.size(); ++i)
        {
            const auto n = meshNormal(triangles[i]);
            for (size_t k = 0; k < 3; ++k)
                putMeshFloat(out, 84 + i * 50 + k * 4, n[k]);
            for (size_t j = 0; j < 3; ++j)
                for (size_t k = 0; k < 3; ++k)
                    putMeshFloat(out, 96 + i * 50 + j * 12 + k * 4, triangles[i][j][k]);
        }
        return out;
    }
} // namespace editor::assets
