#include "Hierarchy.hpp"
#include "Persistence.hpp"
#include <chrono>
#include <iostream>
void require(bool value, const char* message)
{
    if (!value)
        throw std::runtime_error(message);
}
void sameWorld(const editor::Json& a, const editor::Json& b)
{
    auto x = editor::worldMatrices(a), y = editor::worldMatrices(b);
    for (const auto& [id, m] : x)
        for (int i = 0; i < 16; i++)
            require(std::abs(m[i] - y.at(id)[i]) < 1e-4, "world transform changed");
}
int main(int argc, char** argv)
{
    try
    {
        require(argc == 2, "fixtures required");
        auto            fixture = editor::read(std::filesystem::path(argv[1]) / "hierarchy.scene.json");
        editor::History h;
        h.replace(fixture);
        auto next = fixture;
        editor::reparentNodes(next, {"shelf", "box"}, "target");
        sameWorld(fixture, next);
        h.commit(next);
        h.undo();
        require(h.scene == fixture && h.past.empty(), "undo did not restore hierarchy/order");
        h.redo();
        require(h.scene == next, "redo failed");
        for (int kind = 0; kind < 4; kind++)
        {
            auto s = fixture, original = s;
            bool rejected = false;
            try
            {
                if (kind == 0)
                    editor::reparentNodes(s, {"room"}, "box");
                if (kind == 1)
                {
                    s["nodes"][3]["transform"]["scale"] = {0, 1, 1};
                    editor::reparentNodes(s, {"box"}, "target");
                }
                if (kind == 2)
                {
                    s["nodes"][3]["transform"]["scale"] = {2, 1, 1};
                    editor::reparentNodes(s, {"box"}, "target");
                }
                if (kind == 3)
                {
                    s["nodes"][2]["locked"] = true;
                    editor::deleteNodes(s, {"room"});
                }
            }
            catch (...)
            {
                rejected = true;
            }
            require(rejected, "invalid hierarchy operation accepted");
        }
        auto s = fixture;
        editor::groupNodes(s, {"shelf", "box", "other"}, "group");
        sameWorld(fixture, s);
        auto children = editor::ungroupNodes(s, {"group"});
        require(children == std::vector<std::string>({"shelf", "other"}), "ungroup children mismatch");
        sameWorld(fixture, s);
        int  counter = 0;
        auto copies  = editor::duplicateNodes(s, {"shelf", "box"}, [&] { return "copy-" + std::to_string(counter++); });
        require(copies.size() == 1 && s["nodes"].size() == 27, "duplicate subtree mismatch");
        editor::deleteNodes(s, copies);
        require(s["nodes"].size() == 20, "batch delete mismatch");
        editor::reparentNodes(s, {"other"}, nullptr, "room");
        require(s["nodes"][0]["id"] == "other", "sibling order mismatch");
        s = fixture;
        editor::setNodeFlag(s, {"room"}, "hidden", true);
        editor::setNodeFlag(s, {"room"}, "locked", true);
        require(
          editor::inheritedFlag(s, "box", "hidden") && editor::inheritedFlag(s, "box", "locked"),
          "flags not inherited");
        bool rejected = false;
        try
        {
            editor::setNodeFlag(s, {"box"}, "locked", false);
        }
        catch (...)
        {
            rejected = true;
        }
        require(rejected, "ancestor lock bypassed");
        auto folder =
          std::filesystem::temp_directory_path()
          / ("nova-persistence-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
        std::filesystem::create_directories(folder / "source/assets");
        s["assets"]["mesh"]      = {{"path", "assets/model.glb"}, {"sourceSpace", true}};
        s["nodes"][0]["assetId"] = "mesh";
        {
            std::ofstream f(folder / "source/assets/model.glb", std::ios::binary);
            f << "asset-bytes";
        }
        editor::saveRecovery(folder / "recovery", s, fixture, folder / "source/project.json", folder / "source");
        auto recovery = editor::readRecovery(folder / "recovery");
        require(recovery.scene == s && recovery.saved == fixture, "recovery baseline/document mismatch");
        editor::saveProject(folder / "export/project.json", recovery.scene, recovery.root);
        require(editor::read(folder / "export/project.json") == s, "save as mismatch");
        require(std::filesystem::file_size(folder / "export/assets/model.glb") == 11, "asset copy missing");
        auto old = editor::read(folder / "export/project.json");
        std::filesystem::remove(folder / "source/assets/model.glb");
        rejected = false;
        try
        {
            editor::saveProject(folder / "export/project.json", s, folder / "source");
        }
        catch (...)
        {
            rejected = true;
        }
        require(rejected && editor::read(folder / "export/project.json") == old, "failed save damaged old project");
        std::filesystem::remove_all(folder);
        std::cout << "Hierarchy: 20 nodes, reparent/group/order/locks/history; self-contained recovery and failed-save "
                     "preservation passed\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
