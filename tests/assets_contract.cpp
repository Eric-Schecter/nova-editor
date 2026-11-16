#include "Assets.hpp"
#include <iostream>
void require(bool v, const char* message)
{
    if (!v)
        throw std::runtime_error(message);
}
void close(double a, double b)
{
    require(std::abs(a - b) < 1e-5, "geometry value mismatch");
}
int main(int argc, char** argv)
{
    try
    {
        if (argc < 2)
            throw std::runtime_error("Fixtures required");
        auto          root = std::filesystem::path(argv[1]);
        std::ifstream source(root / "primitives.json");
        auto          specs = editor::Json::parse(source);
        for (const auto& spec : specs)
        {
            auto type     = spec["type"].get<std::string>();
            auto g        = editor::assets::defaultGeometry(type);
            auto doc      = editor::assets::readGLB(editor::assets::makePrimitive(g));
            auto vertices = editor::assets::geometryVertices(g);
            require(vertices.size() / 24 == spec["triangles"].get<size_t>(), "triangle count mismatch");
            require(*editor::assets::geometryData(doc) == g, "parameter metadata missing");
            for (int i = 0; i < 3; i++)
            {
                close(doc.json["accessors"][0]["min"][i].get<double>(), spec["minimum"][i].get<double>());
                close(doc.json["accessors"][0]["max"][i].get<double>(), spec["maximum"][i].get<double>());
            }
            for (size_t i = 0; i < vertices.size(); i += 8)
            {
                double length = 0;
                for (int k = 3; k < 6; k++)
                    length += double(vertices[i + k]) * vertices[i + k];
                close(length, 1);
                require(
                  vertices[i + 6] >= 0 && vertices[i + 6] <= 1 && vertices[i + 7] >= 0 && vertices[i + 7] <= 1,
                  "UV out of range");
            }
            if (argc == 3)
            {
                std::filesystem::create_directories(argv[2]);
                auto          bytes = editor::assets::writeGLB(doc);
                std::ofstream out(std::filesystem::path(argv[2]) / (type + ".glb"), std::ios::binary);
                out.write(reinterpret_cast<const char*>(bytes.data()), std::streamsize(bytes.size()));
            }
        }
        auto doc = editor::assets::readGLB(editor::assets::makePrimitive(editor::assets::defaultGeometry("sphere")));
        auto material           = editor::assets::materialData(doc);
        material["color"]       = {.8, .1, .05};
        material["metallic"]    = .75;
        material["roughness"]   = .2;
        material["normalScale"] = 1.5;
        auto checker            = editor::assets::readBytes(root / "checker.png");
        auto next =
          editor::assets::applyTexture(editor::assets::applyTexture(doc, "baseColor", checker), "normal", checker);
        next                             = editor::assets::applyMaterial(next, material);
        auto g                           = editor::assets::defaultGeometry("sphere");
        g["parameters"]["radius"]        = 2;
        g["parameters"]["widthSegments"] = 24;
        next = editor::assets::readGLB(editor::assets::writeGLB(editor::assets::regenerateGeometry(next, g)));
        require(
          editor::assets::materialData(next) == material && *editor::assets::geometryData(next) == g,
          "material or geometry lost during regeneration");
        for (const auto& image : next.json["images"])
        {
            const auto&           view   = next.json["bufferViews"][image["bufferView"].get<size_t>()];
            size_t                offset = view["byteOffset"], length = view["byteLength"];
            editor::assets::Bytes actual(next.bin.begin() + offset, next.bin.begin() + offset + length);
            require(actual == checker, "texture bytes lost");
        }
        next = editor::assets::applyTexture(next, "baseColor", std::nullopt);
        require(!editor::assets::hasTexture(next, "baseColor"), "texture removal failed");
        bool rejected             = false;
        g["parameters"]["radius"] = 0;
        try
        {
            editor::assets::makePrimitive(g);
        }
        catch (...)
        {
            rejected = true;
        }
        require(rejected, "zero radius accepted");
        auto corrupt = editor::assets::makePrimitive(editor::assets::defaultGeometry("box"));
        corrupt.pop_back();
        rejected = false;
        try
        {
            editor::assets::readGLB(corrupt);
        }
        catch (...)
        {
            rejected = true;
        }
        require(rejected, "truncated GLB accepted");
        std::cout
          << "Six parameter geometries, winding inputs, normals/UV/bounds, PBR and embedded texture retention passed\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
