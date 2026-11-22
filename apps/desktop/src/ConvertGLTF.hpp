#pragma once
#include "Assets.hpp"
#include "Persistence.hpp"

namespace editor::assets
{
    inline int hexDigit(char c)
    {
        if (c >= '0' && c <= '9')
            return c - '0';
        if (c >= 'a' && c <= 'f')
            return c - 'a' + 10;
        if (c >= 'A' && c <= 'F')
            return c - 'A' + 10;
        return -1;
    }

    inline std::string modelResourcePath(const std::string& uri)
    {
        std::string path;
        for (size_t i = 0; i < uri.size(); ++i)
        {
            auto c = uri[i];
            if (c == '%')
            {
                if (i + 2 >= uri.size() || hexDigit(uri[i + 1]) < 0 || hexDigit(uri[i + 2]) < 0)
                    throw std::runtime_error("Invalid resource URI");
                c = static_cast<char>(hexDigit(uri[i + 1]) * 16 + hexDigit(uri[i + 2]));
                i += 2;
            }
            if (static_cast<unsigned char>(c) < 32 || c == '\\' || c == ':' || c == '?' || c == '#')
                throw std::runtime_error("Expected a local relative resource URI");
            path += c;
        }
        std::string normalized;
        size_t start = 0;
        do
        {
            const auto end  = path.find('/', start);
            const auto part = path.substr(start, end - start);
            if (part.empty() || part == ".." || (part == "." && end == std::string::npos))
                throw std::runtime_error("Resource URI escapes the model directory");
            if (part != ".")
            {
                if (!normalized.empty()) normalized += '/';
                normalized += part;
            }
            if (end == std::string::npos)
                break;
            start = end + 1;
        } while (true);
        return normalized;
    }

    inline const std::map<std::string, std::string>& gltfImageTypes()
    {
        static const std::map<std::string, std::string> types{
          {"png", "image/png"},
          {"jpeg", "image/jpeg"},
          {"jpg", "image/jpeg"},
          {"webp", "image/webp"},
          {"ktx2", "image/ktx2"},
          {"avif", "image/avif"}};
        return types;
    }

    inline Bytes decodeModelBase64(const std::string& uri, size_t start)
    {
        static const std::string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        Bytes                    bytes;
        unsigned                 accumulator = 0;
        unsigned                 bits        = 0;
        size_t                   symbols = 0, padding = 0;
        for (size_t i = start; i < uri.size(); ++i)
        {
            const auto c = uri[i];
            if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f')
                continue;
            if (c == '=')
            {
                ++padding;
                continue;
            }
            const auto value = alphabet.find(c);
            if (padding || value == std::string::npos)
                throw std::runtime_error("Invalid Base64 resource");
            ++symbols;
            accumulator = (accumulator << 6) | static_cast<unsigned>(value);
            bits += 6;
            if (bits >= 8)
            {
                bits -= 8;
                if (bytes.size() >= maxBytes)
                    throw std::runtime_error("Resource exceeds 128 MiB");
                bytes.push_back(static_cast<unsigned char>(accumulator >> bits));
            }
        }
        if (symbols % 4 == 1 || padding > 2 || (padding && (symbols + padding) % 4))
            throw std::runtime_error("Invalid Base64 resource length");
        return bytes;
    }

    inline std::pair<Bytes, std::string> readModelResource(
      const std::string& uri, const std::function<Bytes(const std::string&)>& load)
    {
        if (uri.compare(0, 5, "data:") == 0)
        {
            const auto marker = uri.find(";base64,", 5);
            if (marker == std::string::npos)
                throw std::runtime_error("Expected a Base64 data URI");
            return {decodeModelBase64(uri, marker + 8), uri.substr(5, marker - 5)};
        }
        auto path      = modelResourcePath(uri);
        auto extension = std::filesystem::path(path).extension().string();
        if (!extension.empty())
            extension.erase(0, 1);
        std::transform(
          extension.begin(), extension.end(), extension.begin(), [](unsigned char c) { return std::tolower(c); });
        const auto type = gltfImageTypes().find(extension);
        return {load(path), type == gltfImageTypes().end() ? "" : type->second};
    }

    inline Bytes packGLTF(const Bytes& source, const std::function<Bytes(const std::string&)>& load)
    {
        auto doc = Json::parse(source);
        if (doc.at("asset").at("version") != "2.0")
            throw std::runtime_error("glTF 2.0 required");
        Bytes      bin;
        const auto append = [&](const Bytes& bytes, size_t length) {
            const auto offset = (bin.size() + 3) & ~size_t(3);
            if (length > maxBytes || offset > maxBytes - length)
                throw std::runtime_error("Resources exceed 128 MiB");
            bin.resize(offset);
            bin.insert(bin.end(), bytes.begin(), bytes.begin() + length);
            return offset;
        };
        std::vector<std::pair<size_t, size_t>> buffers;
        for (const auto& buffer : doc.value("buffers", Json::array()))
        {
            auto       resource = readModelResource(buffer.at("uri").get<std::string>(), load);
            const auto length   = buffer.at("byteLength").get<size_t>();
            if (!buffer.at("byteLength").is_number_integer() || !length || length > resource.first.size())
                throw std::runtime_error("Invalid buffer length");
            buffers.emplace_back(append(resource.first, length), length);
        }
        auto       views    = doc.value("bufferViews", Json::array());
        const auto relocate = [&](Json& view) {
            const auto buffer = view.at("buffer").get<size_t>();
            const auto offset = view.value("byteOffset", size_t(0));
            const auto length = view.at("byteLength").get<size_t>();
            if (
              !view.at("buffer").is_number_integer() || !view.at("byteLength").is_number_integer()
              || (view.contains("byteOffset") && !view["byteOffset"].is_number_integer()) || buffer >= buffers.size()
              || offset > buffers[buffer].second || !length || length > buffers[buffer].second - offset)
                throw std::runtime_error("Buffer view is out of range");
            view["buffer"]     = 0;
            view["byteOffset"] = buffers[buffer].first + offset;
        };
        for (auto& view : views)
        {
            relocate(view);
            if (view.contains("extensions"))
                for (const auto* key : {"EXT_meshopt_compression", "KHR_meshopt_compression"})
                    if (view["extensions"].contains(key))
                        relocate(view["extensions"][key]);
        }
        if (doc.contains("images"))
            for (auto& image : doc["images"])
            {
                if (!image.contains("uri"))
                    continue;
                auto       resource = readModelResource(image.at("uri").get<std::string>(), load);
                const auto mime     = image.value("mimeType", resource.second);
                if (
                  resource.first.empty()
                  || std::none_of(gltfImageTypes().begin(), gltfImageTypes().end(), [&](const auto& type) {
                         return type.second == mime;
                     }))
                    throw std::runtime_error("Unsupported image type");
                image["mimeType"]   = mime;
                image["bufferView"] = views.size();
                views.push_back(
                  {{"buffer", 0},
                   {"byteOffset", append(resource.first, resource.first.size())},
                   {"byteLength", resource.first.size()}});
                image.erase("uri");
            }
        if (!views.empty())
            doc["bufferViews"] = views;
        if (!bin.empty())
            doc["buffers"] = Json::array({{{"byteLength", bin.size()}}});
        else
            doc.erase("buffers");
        return writeGLB({doc, bin, {}});
    }

    inline Bytes compactSplitBuffer(Json& doc, const Bytes& bin, std::set<size_t> imageViews)
    {
        auto&                            views = doc.at("bufferViews");
        std::vector<Json*>               references;
        std::function<void(Json&, bool)> collect = [&](Json& value, bool metadata) {
            if (value.is_array())
            {
                for (auto& child : value)
                    collect(child, metadata);
            }
            else if (value.is_object())
            {
                for (auto it = value.begin(); it != value.end(); ++it)
                {
                    const auto& key = it.key();
                    if (key == "extras")
                        continue;
                    if (
                      key == "bufferView"
                      || (metadata && it->is_number() && (key == "values" || key == "arrayOffsets" || key == "stringOffsets")))
                    {
                        if (!it->is_number_integer() || it->get<size_t>() >= views.size())
                            throw std::runtime_error("Invalid buffer view reference");
                        references.push_back(&*it);
                        imageViews.erase(it->get<size_t>());
                    }
                    else
                        collect(*it, metadata || key == "EXT_structural_metadata");
                }
            }
        };
        collect(doc, false);
        auto                     retained = Json::array();
        std::map<size_t, size_t> indices;
        for (size_t index = 0; index < views.size(); ++index)
            if (!imageViews.count(index))
            {
                indices.emplace(index, retained.size());
                retained.push_back(views[index]);
            }
        struct Range
        {
            Json*  view;
            size_t start, end;
        };
        std::vector<Range> ranges;
        const auto         addRange = [&](Json& view) {
            const auto start = view.value("byteOffset", size_t(0));
            const auto count = view.at("byteLength").get<size_t>();
            if (
              view.at("buffer") != 0 || !view.at("byteLength").is_number_integer()
              || (view.contains("byteOffset") && !view["byteOffset"].is_number_integer()) || start > bin.size()
              || !count || count > bin.size() - start)
                throw std::runtime_error("Buffer view out of range");
            ranges.push_back({&view, start, start + count});
        };
        for (auto& view : retained)
        {
            addRange(view);
            if (view.contains("extensions"))
                for (const auto* key : {"EXT_meshopt_compression", "KHR_meshopt_compression"})
                    if (view["extensions"].contains(key))
                        addRange(view["extensions"][key]);
        }
        std::sort(ranges.begin(), ranges.end(), [](const auto& a, const auto& b) { return a.start < b.start; });
        struct Chunk
        {
            size_t start, end, offset;
        };
        std::vector<Chunk> chunks;
        size_t             length = 0;
        for (const auto& range : ranges)
        {
            const auto start = range.start & ~size_t(3);
            if (chunks.empty() || start > chunks.back().end)
                chunks.push_back({start, range.end, (length + 3) & ~size_t(3)});
            auto& chunk                 = chunks.back();
            chunk.end                   = std::max(chunk.end, range.end);
            length                      = chunk.offset + chunk.end - chunk.start;
            (*range.view)["byteOffset"] = chunk.offset + range.start - chunk.start;
        }
        for (auto* reference : references)
            *reference = indices.at(reference->get<size_t>());
        if (retained.empty())
            doc.erase("bufferViews");
        else
            doc["bufferViews"] = std::move(retained);
        Bytes result(length);
        for (const auto& chunk : chunks)
            std::copy(bin.begin() + chunk.start, bin.begin() + chunk.end, result.begin() + chunk.offset);
        return result;
    }

    inline std::map<std::string, Bytes> splitGLB(const Bytes& source)
    {
        auto glb = readGLB(source);
        if (!glb.extra.empty())
            throw std::runtime_error("Custom GLB chunks cannot be unpacked");
        auto&                        doc = glb.json;
        std::map<std::string, Bytes> files;
        size_t                       length = 0;
        if (doc.contains("buffers") && !doc["buffers"].empty())
        {
            auto& buffer = doc["buffers"][0];
            length       = buffer.at("byteLength").get<size_t>();
            if (!buffer.at("byteLength").is_number_integer() || !length || length > glb.bin.size())
                throw std::runtime_error("Invalid BIN length");
            buffer["uri"]      = "model.bin";
            files["model.bin"] = Bytes(glb.bin.begin(), glb.bin.begin() + length);
        }
        size_t           index = 0;
        std::set<size_t> imageViews;
        if (doc.contains("images"))
            for (auto& image : doc["images"])
            {
                ++index;
                if (!image.contains("bufferView"))
                {
                    auto uri = image.value("uri", std::string{});
                    if (uri.compare(0, 5, "data:") != 0 || uri.find(";base64,") == std::string::npos)
                        throw std::runtime_error("External image in GLB");
                    auto resource = readModelResource(
                      uri, [](const auto&) -> Bytes { throw std::runtime_error("External image in GLB"); });
                    const auto type =
                      std::find_if(gltfImageTypes().begin(), gltfImageTypes().end(), [&](const auto& entry) {
                          return entry.second == resource.second;
                      });
                    if (type == gltfImageTypes().end())
                        throw std::runtime_error("Unsupported image type");
                    const auto name = "image-" + std::to_string(index) + "." + type->first;
                    files[name]     = std::move(resource.first);
                    image["uri"]    = name;
                    continue;
                }
                const auto& view   = doc.at("bufferViews").at(image.at("bufferView").get<size_t>());
                const auto  offset = view.value("byteOffset", size_t(0));
                const auto  count  = view.at("byteLength").get<size_t>();
                const auto  mime   = image.at("mimeType").get<std::string>();
                const auto  type =
                  std::find_if(gltfImageTypes().begin(), gltfImageTypes().end(), [&](const auto& entry) {
                      return entry.second == mime;
                  });
                if (
                  type == gltfImageTypes().end() || view.at("buffer") != 0 || offset > length || !count
                  || count > length - offset)
                    throw std::runtime_error("Invalid embedded image");
                const auto name = "image-" + std::to_string(index) + "." + type->first;
                files[name]     = Bytes(glb.bin.begin() + offset, glb.bin.begin() + offset + count);
                image["uri"]    = name;
                imageViews.insert(image.at("bufferView").get<size_t>());
                image.erase("bufferView");
            }
        if (!imageViews.empty())
        {
            auto compact = compactSplitBuffer(doc, files.at("model.bin"), std::move(imageViews));
            if (compact.empty())
            {
                doc.erase("buffers");
                files.erase("model.bin");
            }
            else
            {
                doc["buffers"][0]["byteLength"] = compact.size();
                files["model.bin"]              = std::move(compact);
            }
        }
        const auto json     = doc.dump(2);
        files["model.gltf"] = Bytes(json.begin(), json.end());
        return files;
    }
} // namespace editor::assets
