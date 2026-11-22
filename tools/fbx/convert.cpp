#include "Assets.hpp"
#include <assimp/Exporter.hpp>
#include <assimp/Importer.hpp>
#include <assimp/GltfMaterial.h>
#include <assimp/postprocess.h>
#include <assimp/scene.h>
#include <cctype>
#include <iostream>

namespace
{
using namespace editor::assets;

bool copyTexture(aiMaterial& material, aiTextureType source, aiTextureType target)
{
    aiString path;
    unsigned uv = 0;
    if (material.GetTexture(source, 0, &path, nullptr, &uv) != AI_SUCCESS)
        return false;
    material.AddProperty(&path, AI_MATKEY_TEXTURE(target, 0));
    material.AddProperty(&uv, 1, AI_MATKEY_UVWSRC(target, 0));
    return true;
}

template<class Key>
void removeDuplicateTimes(Key* keys, unsigned& count, float ticksPerSecond)
{
    unsigned written = 0;
    for (unsigned i = 0; i < count; ++i)
    {
        const auto time = static_cast<float>(keys[i].mTime / ticksPerSecond);
        if (written && time == static_cast<float>(keys[written - 1].mTime / ticksPerSecond))
            keys[written - 1] = keys[i];
        else
            keys[written++] = keys[i];
    }
    count = written;
}

void normalizeAnimationTimes(const aiScene& scene)
{
    // Different FBX ticks can round to the same float32 second in a glTF sampler.
    for (unsigned i = 0; i < scene.mNumAnimations; ++i)
    {
        auto& animation = *scene.mAnimations[i];
        if (!(animation.mTicksPerSecond > 0))
            animation.mTicksPerSecond = 25;
        const auto ticks = static_cast<float>(animation.mTicksPerSecond);
        for (unsigned j = 0; j < animation.mNumChannels; ++j)
        {
            auto& channel = *animation.mChannels[j];
            removeDuplicateTimes(channel.mPositionKeys, channel.mNumPositionKeys, ticks);
            removeDuplicateTimes(channel.mRotationKeys, channel.mNumRotationKeys, ticks);
            removeDuplicateTimes(channel.mScalingKeys, channel.mNumScalingKeys, ticks);
        }
    }
}

void makeNovaCompatible(const std::filesystem::path& path)
{
    auto glb = readGLB(readBytes(path));
    // Assimp emits FB_ngon_encoding even after triangulation. Nova uses the triangle indices.
    for (auto& mesh : glb.json["meshes"])
        for (auto& primitive : mesh["primitives"])
            if (primitive.contains("extensions"))
                primitive["extensions"].erase("FB_ngon_encoding");
    bool hasVolume = false;
    for (auto& material : glb.json["materials"])
    {
        if (!material.contains("extensions"))
            continue;
        auto& extensions = material["extensions"];
        auto volume = extensions.find("KHR_materials_volume");
        if (volume != extensions.end() && volume->value("thicknessFactor", 0.0) == 0.0 &&
            !volume->contains("thicknessTexture"))
            extensions.erase(volume);
        hasVolume |= extensions.contains("KHR_materials_volume");
    }
    for (auto key : {"extensionsUsed", "extensionsRequired"})
        if (glb.json.contains(key))
        {
            auto& values = glb.json[key];
            values.erase(std::remove_if(values.begin(), values.end(), [&](const auto& e) {
                return e == "FB_ngon_encoding" || (!hasVolume && e == "KHR_materials_volume");
            }), values.end());
        }
    for (const auto& image : glb.json.value("images", editor::Json::array()))
        if (image.contains("uri") && image["uri"].get<std::string>().rfind("data:", 0) != 0)
            throw std::runtime_error("Missing embedded texture; embed the images in the input model");
    const auto bytes = writeGLB(glb);
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (!output)
        throw std::runtime_error("Cannot write GLB");
}
} // namespace

int main(int argc, char** argv)
{
    try
    {
        using namespace editor::assets;
        if (argc != 3)
            throw std::runtime_error("Usage: nova_fbx input.fbx output.glb | input.glb output.fbx");
        const auto source = std::filesystem::u8path(argv[1]), target = std::filesystem::u8path(argv[2]);
        const auto extension = [](const auto& path) {
            auto value = path.extension().string();
            for (auto& ch : value) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
            return value;
        };
        const auto toGLB = extension(target) == ".glb";
        if (!(extension(source) == ".fbx" && toGLB) &&
            !(extension(source) == ".glb" && extension(target) == ".fbx"))
            throw std::runtime_error("Expected FBX to GLB or GLB to FBX");
        const auto bytes = readBytes(source);
        Assimp::Importer importer;
        const auto* scene = importer.ReadFileFromMemory(bytes.data(), bytes.size(),
            aiProcess_Triangulate | aiProcess_ValidateDataStructure, toGLB ? "fbx" : "glb");
        if (!scene || !scene->HasMeshes())
            throw std::runtime_error(std::string("Cannot read model: ") + importer.GetErrorString());
        // FBX's classic material channels carry the two embedded maps through Assimp's exporter.
        // The suffix identifies Nova's channel mapping without changing arbitrary FBX materials.
        const std::string marker = " [NovaPBR:";
        for (unsigned i = 0; i < scene->mNumMaterials; ++i)
        {
            auto& material = *scene->mMaterials[i];
            aiString materialName;
            material.Get(AI_MATKEY_NAME, materialName);
            const std::string name = materialName.C_Str();
            if (toGLB)
            {
                const auto start = name.rfind(marker);
                if (start == std::string::npos || name.back() != ']')
                    continue;
                const auto metadata = editor::Json::parse(
                    name.substr(start + marker.size(), name.size() - start - marker.size() - 1),
                    nullptr, false);
                if (!metadata.is_array() || metadata.size() != 4 ||
                    !metadata[0].is_boolean() || !metadata[1].is_boolean() ||
                    !metadata[2].is_number() || !metadata[3].is_number())
                    continue;
                if (metadata[0] == true)
                    copyTexture(material, aiTextureType_AMBIENT, aiTextureType_LIGHTMAP);
                if (metadata[1] == true)
                    copyTexture(material, aiTextureType_SHININESS, aiTextureType_DIFFUSE_ROUGHNESS);
                const auto metallic = metadata[2].get<ai_real>();
                const auto roughness = metadata[3].get<ai_real>();
                material.AddProperty(&metallic, 1, AI_MATKEY_METALLIC_FACTOR);
                material.AddProperty(&roughness, 1, AI_MATKEY_ROUGHNESS_FACTOR);
                const aiString original(name.substr(0, start));
                material.AddProperty(&original, AI_MATKEY_NAME);
            }
            else
            {
                const bool ao = copyTexture(material, aiTextureType_LIGHTMAP, aiTextureType_AMBIENT);
                const bool mr = copyTexture(material, aiTextureType_DIFFUSE_ROUGHNESS, aiTextureType_SHININESS) ||
                    copyTexture(material, aiTextureType_METALNESS, aiTextureType_SHININESS);
                ai_real metallic = 1, roughness = 1;
                material.Get(AI_MATKEY_METALLIC_FACTOR, metallic);
                material.Get(AI_MATKEY_ROUGHNESS_FACTOR, roughness);
                const auto tagged = name + marker + editor::Json::array({ao, mr, metallic, roughness}).dump() + "]";
                if (tagged.size() < sizeof(materialName.data))
                {
                    const aiString tag(tagged);
                    material.AddProperty(&tag, AI_MATKEY_NAME);
                }
            }
        }
        if (toGLB) normalizeAnimationTimes(*scene);
        Assimp::Exporter exporter;
        if (exporter.Export(scene, toGLB ? "glb2" : "fbx", target.u8string()) != AI_SUCCESS)
            throw std::runtime_error(exporter.GetErrorString());
        if (toGLB)
            makeNovaCompatible(target);
        if (!std::filesystem::is_regular_file(target) || !std::filesystem::file_size(target) ||
            std::filesystem::file_size(target) > maxBytes)
            throw std::runtime_error("Converted model exceeds 128 MiB or is empty");
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
