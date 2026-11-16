#include "../apps/desktop/src/ModelEditing.hpp"
#include <iostream>
void require(bool v, const char* m)
{
    if (!v)
        throw std::runtime_error(m);
}
int main(int argc, char** argv)
{
    try
    {
        auto bytes = editor::assets::readBytes(std::filesystem::path(argv[1]) / "model-parts.glb");
        auto model = editor::assets::decodeModel(bytes);
        require(model.nodes.size() == 8 && model.parts.size() == 3, "Model structure mismatch");
        auto s               = editor::emptyScene();
        s["assets"]["model"] = {{"path", "assets/model.glb"}, {"sourceSpace", true}};
        s["nodes"].push_back(
          {{"id", "model"},
           {"name", "Model"},
           {"parentId", nullptr},
           {"assetId", "model"},
           {"transform", editor::identity()}});
        auto   initial  = s;
        size_t i        = 0;
        auto   allocate = [&] { return "generated-" + std::to_string(++i); };
        auto   files    = editor::assets::expandModel(s, "model", model, allocate);
        editor::validate(s);
        require(
          s["nodes"].size() == 9 && s["assets"].size() == 3 && !s["nodes"][0].contains("assetId"), "Expand failed");
        auto        worlds = editor::worldMatrices(s);
        std::string base, top, body;
        for (const auto& n : s["nodes"])
        {
            if (n["name"] == "Base")
                base = n["id"];
            if (n["name"] == "Top")
                top = n["id"];
            if (n["name"] == "Body")
                body = n["id"];
        }
        require(
          editor::nodeById(s, top)["parentId"] == body && std::abs(worlds.at(top)[13] - 2.4) < 1e-5,
          "Node transform lost");
        std::string baseAsset, topAsset;
        for (const auto& n : s["nodes"])
        {
            if (n["parentId"] == base)
                baseAsset = n["assetId"];
            if (n["parentId"] == top)
                topAsset = n["assetId"];
        }
        require(baseAsset == topAsset, "Shared mesh not retained");
        auto red     = editor::assets::readGLB(model.files.at("mesh-0-0")),
             blue    = editor::assets::readGLB(model.files.at("mesh-0-1")),
             checker = editor::assets::readGLB(model.files.at("mesh-1-0"));
        auto m       = editor::assets::materialData(red);
        m["color"]   = {.1, .8, .05};
        auto edited  = editor::assets::applyMaterial(red, m);
        require(
          editor::assets::materialData(blue)["name"] == "Ocean blue"
            && editor::assets::materialData(edited) != editor::assets::materialData(red),
          "Slots not independent");
        require(
          editor::assets::hasTexture(checker, "baseColor") && !editor::assets::hasTexture(red, "baseColor"),
          "Slot texture lost");
        editor::History h;
        h.replace(initial);
        h.commit(s);
        h.undo();
        require(h.scene == initial, "Expansion undo not atomic");
        h.redo();
        require(h.scene == s, "Expansion redo failed");
        auto old                              = initial;
        old["assets"]["model"]["sourceSpace"] = false;
        editor::assets::expandModel(old, "model", model, allocate);
        require(old["nodes"].size() == 10, "Legacy normalization missing");
        auto source = editor::assets::readGLB(bytes);
        source.json["nodes"][1].erase("translation");
        auto t                            = editor::identity();
        t["scale"]                        = {-2, 1, 3};
        t["position"]                     = {2, 3, -1};
        source.json["nodes"][1]["matrix"] = editor::localMatrix(t);
        auto mirror                       = editor::assets::decodeModel(editor::assets::writeGLB(source));
        require(mirror.nodes[1]["transform"]["scale"][0] == -2, "Mirrored matrix lost");
        for (int test = 0; test < 5; test++)
        {
            auto bad = editor::assets::readGLB(bytes);
            if (test == 0)
                bad.json["nodes"][0]["children"].push_back(0);
            if (test == 1)
                bad.json["animations"] = editor::Json::array({editor::Json::object()});
            if (test == 2)
                bad.json["materials"][0]["alphaMode"] = "BLEND";
            if (test == 3)
                bad.json["accessors"][0]["count"] = 4294967296ULL;
            if (test == 4)
                bad.json["nodes"][1]["scale"] = {0, 1, 1};
            bool rejected = false;
            try
            {
                editor::assets::decodeModel(editor::assets::writeGLB(bad));
            }
            catch (...)
            {
                rejected = true;
            }
            require(rejected, "Unsupported model accepted");
        }
        std::cout << "Internal hierarchy, slots, shared meshes, PBR/texture isolation, undo, legacy normalization and "
                     "invalid-model rejection passed\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
