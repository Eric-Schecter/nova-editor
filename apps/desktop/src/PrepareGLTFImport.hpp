#pragma once
#include "Hierarchy.hpp"
#include "Assets.hpp"

namespace editor::assets
{
    inline bool expandSparseAccessors(GLB& doc)
    {
        auto& json = doc.json;
        if (!json.contains("accessors")) return false;
        const std::map<int, size_t> widths{{5120, 1}, {5121, 1}, {5122, 2}, {5123, 2}, {5125, 4}, {5126, 4}};
        const std::map<std::string, size_t> rows{{"SCALAR", 1}, {"VEC2", 2}, {"VEC3", 3}, {"VEC4", 4},
                                                {"MAT2", 2}, {"MAT3", 3}, {"MAT4", 4}};
        const auto align = [](size_t size) { return (size + 3) & ~size_t(3); };
        const auto originalSize = doc.bin.size();
        const auto viewStart = [&](size_t index, size_t offset, size_t size) {
            const auto& view = json.at("bufferViews").at(index);
            const auto start = view.value("byteOffset", size_t(0));
            const auto length = view.at("byteLength").get<size_t>();
            if (view.at("buffer") != 0 || start > originalSize || offset > originalSize - start ||
                size > originalSize - start - offset || offset > length || size > length - offset)
                throw std::runtime_error("Sparse accessor buffer out of bounds");
            return start + offset;
        };
        for (auto& accessor : json["accessors"])
        {
            if (!accessor.contains("sparse")) continue;
            const auto& sparse = accessor.at("sparse");
            const auto& indices = sparse.at("indices");
            const auto& values = sparse.at("values");
            const auto count = accessor.at("count").get<size_t>();
            const auto replacements = sparse.at("count").get<size_t>();
            const auto type = accessor.at("type").get<std::string>();
            const auto rowCount = rows.at(type);
            const auto width = widths.at(accessor.at("componentType").get<int>());
            const auto elementSize = rowCount * (type.compare(0, 3, "MAT") == 0 ? align(rowCount * width) : width);
            const auto indexType = indices.at("componentType").get<int>();
            if (replacements == 0 || replacements > count ||
                (indexType != 5121 && indexType != 5123 && indexType != 5125))
                throw std::runtime_error("Invalid sparse accessor");
            const auto indexSize = widths.at(indexType);
            const auto offset = align(doc.bin.size());
            if (offset > maxBytes || count > (maxBytes - offset) / elementSize)
                throw std::runtime_error("Expanded sparse accessor exceeds 128 MiB");
            const auto indicesStart = viewStart(indices.at("bufferView"), indices.value("byteOffset", size_t(0)),
                                                replacements * indexSize);
            const auto valuesStart = viewStart(values.at("bufferView"), values.value("byteOffset", size_t(0)),
                                               replacements * elementSize);
            doc.bin.resize(offset + count * elementSize);
            if (accessor.contains("bufferView"))
            {
                const auto view = accessor.at("bufferView").get<size_t>();
                const auto stride = json.at("bufferViews").at(view).value("byteStride", elementSize);
                if (stride < elementSize || stride > maxBytes / count)
                    throw std::runtime_error("Invalid sparse accessor stride");
                const auto base = viewStart(view, accessor.value("byteOffset", size_t(0)),
                                            (count - 1) * stride + elementSize);
                for (size_t i = 0; i < count; ++i)
                    std::copy_n(doc.bin.begin() + base + i * stride, elementSize,
                                doc.bin.begin() + offset + i * elementSize);
            }
            size_t previous = 0;
            for (size_t i = 0; i < replacements; ++i)
            {
                size_t index = 0;
                for (size_t byte = 0; byte < indexSize; ++byte)
                    index |= size_t(doc.bin[indicesStart + i * indexSize + byte]) << (8 * byte);
                if (index >= count || (i && index <= previous))
                    throw std::runtime_error("Invalid sparse accessor index");
                std::copy_n(doc.bin.begin() + valuesStart + i * elementSize, elementSize,
                            doc.bin.begin() + offset + index * elementSize);
                previous = index;
            }
            accessor["bufferView"] = json["bufferViews"].size();
            accessor["byteOffset"] = 0;
            accessor.erase("sparse");
            json["bufferViews"].push_back({{"buffer", 0}, {"byteOffset", offset}, {"byteLength", count * elementSize}});
        }
        if (doc.bin.size() == originalSize) return false;
        json.at("buffers").at(0)["byteLength"] = doc.bin.size();
        return true;
    }

    inline std::optional<Json> prepareGLTFImport(GLB& doc, const std::string& root,
                                               const std::function<std::string()>& allocate)
    {
        auto& json = doc.json;
        bool changed = expandSparseAccessors(doc);
        bool addedMaterial = false;
        const auto defaultMaterial = json.contains("materials") ? json["materials"].size() : 0;
        if (json.contains("meshes"))
            for (auto& mesh : json["meshes"])
                for (auto& primitive : mesh.at("primitives"))
                    if (!primitive.contains("material"))
                    {
                        primitive["material"] = defaultMaterial;
                        addedMaterial = true;
                    }
        if (addedMaterial)
        {
            if (!json.contains("materials")) json["materials"] = Json::array();
            json["materials"].push_back(Json::object());
        }
        constexpr auto extension = "KHR_lights_punctual";
        const auto declared = [&](const char* key) {
            const auto values = json.value(key, Json::array());
            return std::find(values.begin(), values.end(), extension) != values.end();
        };
        const auto globals = json.value("extensions", Json::object());
        bool present = globals.contains(extension) || declared("extensionsUsed") || declared("extensionsRequired") || json.contains("cameras");
        const auto sourceNodes = json.value("nodes", Json::array());
        for (const auto& node : sourceNodes)
            present |= node.value("extensions", Json::object()).contains(extension) || node.contains("camera");
        if (!present)
        {
            if (changed || addedMaterial) return Json::array();
            return std::nullopt;
        }
        const auto lights = globals.value(extension, Json::object()).value("lights", Json::array());
        Json nodes = Json::array();
        std::set<size_t> visited;
        std::function<void(size_t, const std::string&)> visit = [&](size_t index, const std::string& parent) {
            if (index >= sourceNodes.size() || !visited.insert(index).second)
                throw std::runtime_error("Invalid glTF scene hierarchy");
            const auto& source = sourceNodes[index];
            const auto id = allocate();
            const auto slot = nodes.size();
            nodes.push_back(nullptr);
            for (const auto& child : source.value("children", Json::array()))
                visit(child.get<size_t>(), id);
            const auto reference = source.value("extensions", Json::object());
            if (!reference.contains(extension) && !source.contains("camera") && nodes.size() == slot + 1)
            {
                nodes.erase(slot);
                return;
            }
            auto tr = identity();
            if (source.contains("matrix"))
                tr = decomposeTRS(source.at("matrix").get<Matrix>());
            else
            {
                tr["position"] = source.value("translation", tr["position"]);
                tr["rotation"] = source.value("rotation", tr["rotation"]);
                tr["scale"] = source.value("scale", tr["scale"]);
            }
            Json node = {{"id", id}, {"parentId", parent}, {"name", source.value("name", "Group")},
                         {"transform", tr}};
            if (reference.contains(extension))
            {
                const auto& l = lights.at(reference.at(extension).at("light").get<size_t>());
                const auto extras = l.value("extras", Json::object()).value("novaEditor", Json::object());
                const auto enabled = extras.value("active", true);
                const auto power = enabled ? l.value("intensity", 1.0) : extras.value("intensity", 1.0);
                const auto type = l.at("type").get<std::string>();
                Json props = {{"type", type}, {"color", l.value("color", Json::array({1, 1, 1}))},
                              {"active", enabled}, {"intensity", std::min(100.0, power)},
                              {"shadows", extras.value("shadows", false)}, {"softness", extras.value("softness", 1.0)}};
                if (type != "directional") props["range"] = l.value("range", 0.0);
                if (type == "spot")
                {
                    const auto spot = l.value("spot", Json::object());
                    props["innerConeAngle"] = spot.value("innerConeAngle", 0.0);
                    props["outerConeAngle"] = spot.value("outerConeAngle", .7853981633974483);
                }
                node["name"] = source.value("name", l.value("name", "Light"));
                node["light"] = std::move(props);
            }
            if (source.contains("camera"))
            {
                const auto& camera = json.at("cameras").at(source.at("camera").get<size_t>());
                const auto type = camera.at("type").get<std::string>();
                if (type != "perspective" && type != "orthographic")
                    throw std::runtime_error("Invalid glTF camera projection");
                const auto& lens = camera.at(type);
                const auto nearPlane = std::clamp(lens.at("znear").get<double>(), .0001, 1e6);
                const auto farPlane = std::clamp(lens.value("zfar", std::max(200., nearPlane * 2)),
                                                 nearPlane + .0001, 1e7);
                if (!source.contains("name") && !node.contains("light"))
                    node["name"] = camera.value("name", "Camera");
                Json component = {
                    {"projection", type}, {"focusDistance", 5.}, {"exposure", 1.}, {"primary", false},
                    {"orthographicSize", std::clamp(lens.value("ymag", 5.) * 2, .05, 80.)},
                    {"verticalFov", std::clamp(lens.value("yfov", .7853981633974483) * 57.29577951308232, 1., 179.)},
                    {"nearPlane", nearPlane}, {"farPlane", farPlane},
                };
                if (node.contains("light"))
                    nodes.push_back({{"id", allocate()}, {"parentId", id}, {"name", camera.value("name", "Camera")},
                                     {"transform", identity()}, {"camera", std::move(component)}});
                else
                    node["camera"] = std::move(component);
            }
            nodes[slot] = std::move(node);
        };
        const auto scenes = json.value("scenes", Json::array());
        if (!scenes.empty())
            for (const auto& index : scenes.at(json.value("scene", size_t(0))).value("nodes", Json::array()))
                visit(index.get<size_t>(), root);

        auto removeExtension = [&](Json& owner) {
            if (!owner.contains("extensions")) return;
            owner["extensions"].erase(extension);
            if (owner["extensions"].empty()) owner.erase("extensions");
        };
        removeExtension(json);
        if (json.contains("nodes"))
            for (auto& node : json["nodes"])
            {
                removeExtension(node);
                node.erase("camera");
            }
        json.erase("cameras");
        for (auto key : {"extensionsUsed", "extensionsRequired"})
            if (json.contains(key))
            {
                auto& values = json[key];
                values.erase(std::remove(values.begin(), values.end(), extension), values.end());
                if (values.empty()) json.erase(key);
            }
        return nodes;
    }
} // namespace editor::assets
