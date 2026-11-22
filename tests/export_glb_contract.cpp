#include "../apps/desktop/src/ConvertGLTF.hpp"
#include "../apps/desktop/src/ExportGLB.hpp"
#include "../apps/desktop/src/Persistence.hpp"
#include "../apps/desktop/src/PrepareGLTFImport.hpp"
#include <iostream>
int main(int argc, char** argv)
{
    try
    {
        if (argc != 2)
            throw std::runtime_error("Expected repository root");
        auto root     = std::filesystem::path(argv[1]);
        auto fixture  = root / "tests/fixtures/glb-export";
        auto s        = editor::read(fixture / "project.json");
        auto load     = [&](const std::string& p) { return editor::assets::readBytes(fixture / p); };
        auto full     = editor::assets::exportGLB(s, load),
             selected = editor::assets::exportGLB(s, load, std::vector<std::string>{"left"});
        auto compare  = [&](const auto& bytes, const char* name) {
            auto actual   = editor::assets::readGLB(bytes),
                 expected = editor::assets::readGLB(editor::assets::readBytes(fixture / name));
            if (actual.json != expected.json || actual.bin != expected.bin)
                throw std::runtime_error(std::string("Cross-platform export differs: ") + name);
        };
        compare(full, "expected.glb");
        compare(selected, "expected-selected.glb");
        auto output = root / "output/export-glb-contract/native.glb";
        std::filesystem::create_directories(output.parent_path());
        std::ofstream f(output, std::ios::binary);
        f.write(reinterpret_cast<const char*>(full.data()), full.size());
        s["assets"]["a"]["sourceSpace"] = false;
        auto normalized = editor::assets::readGLB(editor::assets::exportGLB(s, load, std::vector<std::string>{"left"}));
        bool found      = false;
        for (const auto& n : normalized.json["nodes"])
            found |= n.value("name", "") == "Source normalization";
        if (!found)
            throw std::runtime_error("Missing legacy normalization");
        auto alphaRoot = root / "output/alpha-roundtrip";
        auto alpha     = editor::read(root / "tests/fixtures/material-alpha/export-project.json");
        std::filesystem::create_directories(alphaRoot / "assets");
        std::filesystem::copy_file(
          root / "tests/fixtures/material-alpha/Layers.glb",
          alphaRoot / "assets/layers.glb",
          std::filesystem::copy_options::overwrite_existing);
        auto savedRoot = alphaRoot / "native-saved";
        editor::saveProject(savedRoot / "project.json", alpha, alphaRoot);
        editor::saveRecovery(alphaRoot / "native-recovery", alpha, alpha, savedRoot / "project.json", savedRoot);
        auto recovery  = editor::readRecovery(alphaRoot / "native-recovery");
        auto alphaLoad = [&](const std::string& p) { return editor::assets::readBytes(recovery.root / p); };
        auto expected =
          editor::assets::readGLB(editor::assets::readBytes(root / "tests/fixtures/material-alpha/Export.glb"));
        for (bool selectedOnly : {false, true})
        {
            auto data = editor::assets::exportGLB(
              recovery.scene,
              alphaLoad,
              selectedOnly ? std::optional(std::vector<std::string>{"alpha"}) : std::nullopt);
            auto actual = editor::assets::readGLB(data);
            if (actual.json != expected.json || actual.bin != expected.bin)
                throw std::runtime_error("Alpha native save/recovery/export mismatch");
            std::ofstream out(alphaRoot / (selectedOnly ? "native-selected.glb" : "native.glb"), std::ios::binary);
            out.write(reinterpret_cast<const char*>(data.data()), data.size());
        }
        const auto original = editor::assets::readBytes(root / "tests/fixtures/material-alpha/Layers.glb");
        const auto resources = editor::assets::splitGLB(original);
        const auto repacked = editor::assets::packGLTF(resources.at("model.gltf"), [&](const auto& path) {
            return resources.at(path);
        });
        const auto reopened = editor::assets::splitGLB(repacked);
        if (reopened.at("image-1.png") != resources.at("image-1.png") ||
            editor::assets::readGLB(original).json.at("materials") != editor::assets::readGLB(repacked).json.at("materials"))
            throw std::runtime_error("glTF conversion changed materials or texture bytes");
        auto roundtrip = repacked;
        for (int cycle = 0; cycle < 4; ++cycle)
        {
            const auto files = editor::assets::splitGLB(roundtrip);
            const auto& bin = files.at("model.bin");
            const auto& image = files.at("image-1.png");
            if (std::search(bin.begin(), bin.end(), image.begin(), image.end()) != bin.end())
                throw std::runtime_error("Duplicated texture in external BIN");
            roundtrip = editor::assets::packGLTF(files.at("model.gltf"), [&](const auto& path) {
                return files.at(path);
            });
            if (roundtrip != repacked) throw std::runtime_error("GLB grew after repeated conversion");
        }
        if (editor::assets::modelResourcePath("./textures/./base%20color.png") != "textures/base color.png")
            throw std::runtime_error("Relative URI normalization failed");
        using editor::Json;
        editor::assets::GLB import = {Json::parse(R"({
          "scenes":[{"nodes":[0]}], "nodes":[{"camera":0}],
          "cameras":[{"type":"orthographic","orthographic":{"xmag":4,"ymag":3,"znear":0.1,"zfar":90}}],
          "meshes":[{"primitives":[{},{}]}],
          "buffers":[{"byteLength":8}],
          "bufferViews":[{"buffer":0,"byteLength":1},{"buffer":0,"byteOffset":4,"byteLength":1}],
          "accessors":[{"count":3,"type":"SCALAR","componentType":5121,"sparse":{
            "count":1,"indices":{"bufferView":0,"componentType":5121},"values":{"bufferView":1}}}]
        })"), {1, 0, 0, 0, 9, 0, 0, 0}, {}};
        const auto objects = editor::assets::prepareGLTFImport(import, "root", [] { return "camera"; });
        if (!objects || objects->size() != 1 || objects->at(0)["camera"]["orthographicSize"] != 6 ||
            import.json.contains("cameras") || import.json["nodes"][0].contains("camera") ||
            import.json["materials"].size() != 1 || import.json["meshes"][0]["primitives"][1]["material"] != 0 ||
            import.json["accessors"][0].contains("sparse") ||
            editor::assets::Bytes(import.bin.begin() + 8, import.bin.end()) != editor::assets::Bytes{0, 9, 0})
            throw std::runtime_error("glTF camera, default material or sparse accessor import failed");
        std::cout << "PASS native/Web GLB parity, embedded images, hierarchy, selection and legacy normalization\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
