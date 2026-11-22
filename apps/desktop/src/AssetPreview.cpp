#include "AssetPreview.hpp"

#define STB_IMAGE_STATIC
#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_JPEG
#define STBI_ONLY_PNG
#define STBI_NO_STDIO
#include "../../../third_party/stb/stb_image.h"

#include <memory>
#include <set>

namespace editor::assets
{
    namespace
    {
        struct PreviewVertex { double x, y, z, u, v; };
        struct Texture
        {
            int width = 0, height = 0;
            Bytes pixels;
        };
        struct Material
        {
            std::array<double, 4> color{.75, .75, .75, 1};
            std::array<double, 3> emission{};
            double metal = 0, rough = .6, cutoff = 0;
            int texture = -1, uv = 0;
        };
        struct Mesh
        {
            std::vector<PreviewVertex> vertices;
            std::vector<size_t> indices;
            Material material;
        };

        struct Accessor
        {
            const Bytes& bin;
            size_t count, offset, stride, size;
            int component;
            bool normalized;

            double get(size_t i, size_t c = 0) const
            {
                if (i >= count) throw std::runtime_error("Invalid preview index");
                const auto* src = bin.data() + offset + i * stride + c * size;
                uint32_t value = src[0];
                for (size_t byte = 1; byte < size; ++byte) value |= uint32_t(src[byte]) << (byte * 8);
                if (component == 5126)
                {
                    float number;
                    std::memcpy(&number, &value, sizeof(number));
                    return number;
                }
                return normalized ? value / (size == 1 ? 255. : 65535.) : value;
            }
        };

        Accessor accessor(const GLB& doc, size_t id, size_t components)
        {
            const auto& a = doc.json.at("accessors").at(id);
            const auto& view = doc.json.at("bufferViews").at(a.at("bufferView").get<size_t>());
            const int type = a.at("componentType");
            const size_t size = type == 5121 ? 1 : type == 5123 ? 2 : type == 5125 || type == 5126 ? 4 : 0;
            const auto count = a.at("count").get<size_t>();
            const auto stride = view.value("byteStride", size * components);
            const auto base = view.value("byteOffset", size_t(0));
            const auto offset = a.value("byteOffset", size_t(0));
            const auto element = size * components;
            if (!size || a.contains("sparse") || !count || view.at("buffer") != 0 || stride < element ||
                base > doc.bin.size() || offset > doc.bin.size() - base || element > doc.bin.size() - base - offset ||
                count - 1 > (doc.bin.size() - base - offset - element) / stride)
                throw std::runtime_error("Invalid preview accessor");
            return {doc.bin, count, base + offset, stride, size, type, a.value("normalized", false)};
        }

        Texture decode(const GLB& doc, int id)
        {
            Texture image;
            const auto& texture = doc.json.at("textures").at(id);
            const auto& source = doc.json.at("images").at(texture.at("source").get<size_t>());
            const auto& view = doc.json.at("bufferViews").at(source.at("bufferView").get<size_t>());
            const auto offset = view.value("byteOffset", size_t(0));
            const size_t length = view.at("byteLength");
            if (offset > doc.bin.size() || length > doc.bin.size() - offset) return image;
            int channels;
            const auto* data = doc.bin.data() + offset;
            if (!stbi_info_from_memory(data, int(length), &image.width, &image.height, &channels) ||
                image.width > 4096 || image.height > 4096)
                return image;
            const std::unique_ptr<stbi_uc, decltype(&stbi_image_free)> sourcePixels(
                stbi_load_from_memory(data, int(length), &image.width, &image.height, &channels, 4), stbi_image_free);
            if (!sourcePixels) return image;
            const auto sourceWidth = image.width, sourceHeight = image.height;
            const double scale = std::min(1., 512. / std::max(sourceWidth, sourceHeight));
            image.width = std::max(1, int(std::lround(scale * sourceWidth)));
            image.height = std::max(1, int(std::lround(scale * sourceHeight)));
            image.pixels.resize(image.width * image.height * 4);
            for (int y = 0; y < image.height; ++y)
                for (int x = 0; x < image.width; ++x)
                    std::memcpy(image.pixels.data() + (y * image.width + x) * 4,
                        sourcePixels.get() + ((y * sourceHeight / image.height) * sourceWidth + x * sourceWidth / image.width) * 4, 4);
            return image;
        }

        int encode(double v)
        {
            return int(std::lround(std::sqrt(std::clamp(v, 0., 1.)) * 255));
        }
    }

    std::vector<PreviewRun> assetPreview(const std::filesystem::path& path)
    {
        try
        {
            const auto doc = readGLB(readBytes(path));
            const auto& json = doc.json;
            const auto& nodes = json.at("nodes");
            std::vector<Material> materials;
            std::map<int, Texture> textures;
            for (const auto& m : json.value("materials", Json::array()))
            {
                const auto p = m.value("pbrMetallicRoughness", Json::object());
                auto material = Material{};
                material.color = p.value("baseColorFactor", std::array<double, 4>{1, 1, 1, 1});
                material.metal = p.value("metallicFactor", 1.);
                material.rough = p.value("roughnessFactor", 1.);
                material.emission = m.value("emissiveFactor", material.emission);
                const auto alpha = m.value("alphaMode", std::string("OPAQUE"));
                material.cutoff = alpha == "MASK" ? m.value("alphaCutoff", .5) : alpha == "BLEND" ? .12 : 0.;
                if (p.contains("baseColorTexture"))
                {
                    const auto& info = p.at("baseColorTexture");
                    material.texture = info.at("index");
                    material.uv = info.value("texCoord", 0);
                    if (!textures.count(material.texture))
                    {
                        try { textures.emplace(material.texture, decode(doc, material.texture)); }
                        catch (const std::exception&) { textures.emplace(material.texture, Texture{}); }
                    }
                }
                materials.push_back(material);
            }

            std::vector<Mesh> meshes;
            std::set<size_t> active;
            size_t remaining = 1200000;
            double minX = INFINITY, minY = INFINITY, maxX = -INFINITY, maxY = -INFINITY;
            std::function<void(size_t, const Matrix&)> visit = [&](size_t index, const Matrix& parent) {
                if (!remaining || active.size() >= 128 || !active.insert(index).second) return;
                const auto& node = nodes.at(index);
                auto transform = identity();
                transform["position"] = node.value("translation", transform["position"]);
                transform["rotation"] = node.value("rotation", transform["rotation"]);
                transform["scale"] = node.value("scale", transform["scale"]);
                const auto local = node.contains("matrix") ? node.at("matrix").get<Matrix>() : localMatrix(transform);
                const auto world = multiply(parent, local);
                if (node.contains("mesh"))
                    for (const auto& p : json.at("meshes").at(node.at("mesh").get<size_t>()).at("primitives"))
                    {
                        if (p.value("mode", 4) != 4 || !remaining) continue;
                        const auto& attributes = p.at("attributes");
                        const auto positions = accessor(doc, attributes.at("POSITION"), 3);
                        const auto indices = p.contains("indices") ? std::optional<Accessor>(accessor(doc, p.at("indices"), 1)) : std::nullopt;
                        const auto count = indices ? indices->count : positions.count;
                        if (count > remaining || positions.count > remaining) continue;
                        remaining -= count;
                        Mesh mesh;
                        const auto id = p.value("material", materials.size());
                        if (id < materials.size()) mesh.material = materials[id];
                        const auto uvKey = "TEXCOORD_" + std::to_string(mesh.material.uv);
                        const auto uv = mesh.material.texture >= 0 && attributes.contains(uvKey)
                            ? std::optional<Accessor>(accessor(doc, attributes.at(uvKey), 2)) : std::nullopt;
                        mesh.vertices.reserve(positions.count);
                        for (size_t i = 0; i < positions.count; ++i)
                        {
                            const auto a = positions.get(i), b = positions.get(i, 1), c = positions.get(i, 2);
                            const auto x = a * world[0] + b * world[4] + c * world[8] + world[12];
                            const auto y = a * world[1] + b * world[5] + c * world[9] + world[13];
                            const auto z = a * world[2] + b * world[6] + c * world[10] + world[14];
                            const PreviewVertex v{.866 * x - .5 * z, .22 * x - .898 * y + .381 * z,
                                           .449 * x + .44 * y + .778 * z, uv ? uv->get(i) : 0, uv ? uv->get(i, 1) : 0};
                            if (!std::isfinite(v.x) || !std::isfinite(v.y) || !std::isfinite(v.z))
                                throw std::runtime_error("Invalid preview geometry");
                            minX = std::min(minX, v.x); maxX = std::max(maxX, v.x);
                            minY = std::min(minY, v.y); maxY = std::max(maxY, v.y);
                            mesh.vertices.push_back(v);
                        }
                        mesh.indices.reserve(count);
                        for (size_t i = 0; i < count; ++i)
                        {
                            const double indexValue = indices ? indices->get(i) : double(i);
                            if (!(indexValue >= 0 && indexValue < mesh.vertices.size()))
                                throw std::runtime_error("Invalid preview index");
                            mesh.indices.push_back(size_t(indexValue));
                        }
                        meshes.push_back(std::move(mesh));
                    }
                for (const auto& child : node.value("children", Json::array())) visit(child.get<size_t>(), world);
                active.erase(index);
            };
            for (const auto& root : json.at("scenes").at(json.value("scene", size_t(0))).at("nodes"))
                visit(root.get<size_t>(), localMatrix(identity()));
            if (meshes.empty()) return {};

            const double scale = std::min((previewWidth - 14) / std::max(1e-9, maxX - minX),
                                          (previewHeight - 14) / std::max(1e-9, maxY - minY));
            std::vector<double> depth(previewWidth * previewHeight, -INFINITY);
            std::vector<ImU32> pixels(depth.size());
            for (auto& mesh : meshes)
            {
                for (auto& v : mesh.vertices)
                {
                    v.x = previewWidth / 2. + (v.x - (minX + maxX) / 2) * scale;
                    v.y = previewHeight / 2. + (v.y - (minY + maxY) / 2) * scale;
                    v.z *= scale;
                }
                const auto& material = mesh.material;
                const Texture* texture = nullptr;
                if (const auto found = textures.find(material.texture); found != textures.end() && !found->second.pixels.empty())
                    texture = &found->second;
                for (size_t i = 0; i + 2 < mesh.indices.size(); i += 3)
                {
                    const auto& a = mesh.vertices[mesh.indices[i]];
                    const auto& b = mesh.vertices[mesh.indices[i + 1]];
                    const auto& c = mesh.vertices[mesh.indices[i + 2]];
                    const double dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
                    const double ex = c.x - a.x, ey = c.y - a.y, ez = c.z - a.z;
                    const double area = dx * ey - dy * ex;
                    if (std::abs(area) < 1e-7) continue;
                    const double nx = dy * ez - dz * ey, ny = dz * ex - dx * ez;
                    const double normal = std::copysign(1. / std::hypot(nx, ny, area), area);
                    const double key = std::max(0., (-.42 * nx - .49 * ny + .76 * area) * normal);
                    const double rim = std::max(0., (.7 * nx + .28 * ny + .66 * area) * normal);
                    const double light = .24 + .65 * key + .23 * rim;
                    const double gloss = (.06 + material.metal * .15) * std::pow(key, 5 + 22 * (1 - material.rough));
                    const int left = std::max(0, int(std::floor(std::min({a.x, b.x, c.x}))));
                    const int right = std::min(previewWidth, int(std::ceil(std::max({a.x, b.x, c.x}))));
                    const int top = std::max(0, int(std::floor(std::min({a.y, b.y, c.y}))));
                    const int bottom = std::min(previewHeight, int(std::ceil(std::max({a.y, b.y, c.y}))));
                    for (int y = top; y < bottom; ++y)
                        for (int x = left; x < right; ++x)
                        {
                            const double u = ((x + .5 - a.x) * ey - (y + .5 - a.y) * ex) / area;
                            const double v = (dx * (y + .5 - a.y) - dy * (x + .5 - a.x)) / area;
                            const double w = 1 - u - v;
                            if (u < 0 || v < 0 || w < 0) continue;
                            const auto z = w * a.z + u * b.z + v * c.z;
                            const int pixel = y * previewWidth + x;
                            if (z <= depth[pixel]) continue;
                            const stbi_uc* sample = nullptr;
                            if (texture)
                            {
                                const double s = w * a.u + u * b.u + v * c.u, t = w * a.v + u * b.v + v * c.v;
                                if (std::isfinite(s) && std::isfinite(t))
                                {
                                    const int tx = int((s - std::floor(s)) * texture->width);
                                    const int ty = int((t - std::floor(t)) * texture->height);
                                    sample = texture->pixels.data() + (ty * texture->width + tx) * 4;
                                }
                            }
                            if (material.cutoff && material.color[3] * (sample ? sample[3] / 255. : 1) < material.cutoff)
                                continue;
                            depth[pixel] = z;
                            int rgb[3];
                            for (int k = 0; k < 3; ++k)
                            {
                                const double texel = sample ? sample[k] / 255. : 1;
                                rgb[k] = encode(material.color[k] * texel * texel * light + gloss + material.emission[k]);
                            }
                            pixels[pixel] = IM_COL32(rgb[0], rgb[1], rgb[2], 255);
                        }
                }
            }
            std::vector<PreviewRun> runs;
            for (int y = 0; y < previewHeight; ++y)
                for (int x = 0; x < previewWidth;)
                {
                    const auto color = pixels[y * previewWidth + x];
                    int end = x + 1;
                    while (end < previewWidth && pixels[y * previewWidth + end] == color) ++end;
                    if (color) runs.push_back({uint8_t(x), uint8_t(y), uint8_t(end - x), color});
                    x = end;
                }
            return runs;
        }
        catch (const std::exception&)
        {
            return {};
        }
    }
}
