#include "../apps/desktop/src/SelectionTransform.hpp"
#include <iostream>
void require(bool v, const char* text)
{
    if (!v)
        throw std::runtime_error(text);
}
void close(const editor::Matrix& a, const editor::Matrix& b)
{
    for (int k = 0; k < 16; k++)
        if (std::abs(a[k] - b[k]) > 2e-4)
            throw std::runtime_error("Selection world matrix mismatch");
}
int main(int argc, char** argv)
{
    try
    {
        auto f    = editor::Json::parse(std::ifstream(std::filesystem::path(argv[1]) / "selection-transforms.json"));
        auto base = f["scene"];
        auto ids  = f["ids"].get<std::vector<std::string>>();
        editor::AssetBounds bounds{{"mesh", {{-.5, -.5, -.5}, {.5, .5, .5}}}};
        for (const auto& c : f["cases"])
        {
            auto s     = base;
            auto frame = editor::selectionFrame(
              base,
              ids,
              "right",
              c["space"] == "local" ? editor::TransformSpace::Local : editor::TransformSpace::World,
              bounds);
            require(
              std::abs(frame.basis[12]) + std::abs(frame.basis[13] - 1) + std::abs(frame.basis[14]) < 1e-5,
              "Group pivot mismatch");
            auto delta        = editor::identity();
            delta["position"] = c["position"];
            delta["rotation"] = editor::eulerQuaternion(c["euler"].get<std::array<float, 3>>());
            delta["scale"]    = c["scale"];
            editor::applySelectionEdits(s, editor::selectionEdits(base, frame, delta));
            auto before = editor::worldMatrices(base), after = editor::worldMatrices(s);
            for (const auto& id : ids)
                close(after.at(id), editor::multiply(c["operation"].get<editor::Matrix>(), before.at(id)));
        }
        auto hierarchy = base;
        hierarchy["nodes"].push_back(
          {{"id", "child"}, {"name", "Child"}, {"parentId", "left"}, {"transform", editor::identity()}});
        auto frame =
          editor::selectionFrame(hierarchy, {"left", "child", "right"}, "child", editor::TransformSpace::Local, bounds);
        require(frame.roots == ids, "Parent/child not deduplicated");
        auto delta        = editor::identity();
        delta["position"] = {1, 2, 3};
        auto changed      = hierarchy;
        editor::applySelectionEdits(changed, editor::selectionEdits(hierarchy, frame, delta));
        require(changed["nodes"][2]["transform"] == hierarchy["nodes"][2]["transform"], "Child transformed twice");
        editor::Camera camera;
        camera.distance = 10;
        editor::Size size{900, 700};
        for (bool orthographic : {false, true})
            for (auto space : {editor::TransformSpace::World, editor::TransformSpace::Local})
                for (auto mode : {editor::Tool::Translate, editor::Tool::Rotate, editor::Tool::Scale})
                {
                    camera.orthographic = orthographic;
                    auto selection      = editor::selectionGizmo(base, ids, "right", space, mode, camera, size, bounds);
                    require(selection.has_value(), "Missing selection gizmo");
                    auto       g = selection->gizmo;
                    editor::V3 a{}, b{};
                    if (mode == editor::Tool::Rotate)
                    {
                        a[0] = g.radius;
                        b[0] = g.radius * std::cos(.5);
                        b[1] = g.radius * std::sin(.5);
                    }
                    else
                    {
                        a[2] = g.radius * .8;
                        b[2] = a[2] + (mode == editor::Tool::Scale ? g.radius * .4 : .5);
                    }
                    auto screen = [&](editor::V3 p) {
                        return *editor::project(editor::point(g.basis, p), camera, size);
                    };
                    auto drag = editor::beginDrag(g, 2, screen(a));
                    require(drag.has_value(), "Missing group drag");
                    auto value = editor::updateDrag(*drag, screen(b));
                    if (mode == editor::Tool::Translate)
                        require(
                          std::abs(value["position"][2].get<double>() - .5) < 1e-4, "Group axis translation wrong");
                    if (mode == editor::Tool::Scale)
                        require(std::abs(value["scale"][2].get<double>() - 1.4) < 1e-4, "Group axis scale wrong");
                    if (mode == editor::Tool::Rotate)
                        require(
                          std::abs(value["rotation"][2].get<double>() - std::sin(.25)) < 1e-4, "Group rotation wrong");
                    auto s = base;
                    editor::applySelectionEdits(s, editor::selectionEdits(base, selection->frame, value));
                }
        editor::History history;
        history.replace(base);
        frame = editor::selectionFrame(base, ids, "right", editor::TransformSpace::World, bounds);
        history.beginPreview();
        for (int i = 1; i <= 40; i++)
        {
            auto next            = base;
            delta                = editor::identity();
            delta["position"][0] = i * .1;
            editor::applySelectionEdits(next, editor::selectionEdits(base, frame, delta));
            history.preview(next);
        }
        history.finishPreview();
        require(
          std::abs(history.scene["nodes"][0]["transform"]["position"][0].get<double>() - 2) < 1e-4,
          "Previews accumulated");
        auto edited = history.scene;
        history.undo();
        require(history.scene == base && history.past.empty(), "Group undo not atomic");
        history.beginPreview();
        history.preview(base);
        history.cancelPreview();
        require(!history.future.empty(), "Cancel cleared redo");
        history.beginPreview();
        auto noop = base;
        editor::applySelectionEdits(noop, editor::selectionEdits(base, frame, editor::identity()));
        history.preview(noop);
        history.finishPreview();
        require(!history.future.empty(), "No-op cleared redo");
        history.redo();
        require(history.scene == edited, "Group redo wrong");
        for (int kind = 0; kind < 5; kind++)
        {
            auto s = base;
            if (kind == 0)
                s["nodes"][1]["locked"] = true;
            if (kind == 1)
                s["nodes"][1]["hidden"] = true;
            if (kind == 2)
            {
                s["nodes"].push_back(
                  {{"id", "parent"}, {"name", "Parent"}, {"parentId", nullptr}, {"transform", editor::identity()}});
                s["nodes"][2]["transform"]["scale"] = {0, 1, 1};
                s["nodes"][0]["parentId"]           = "parent";
            }
            if (kind == 3)
                s["nodes"][1]["transform"]["rotation"] = editor::eulerQuaternion({0, 0, 35});
            auto original = s;
            bool rejected = false;
            try
            {
                auto f     = editor::selectionFrame(s, ids, "right", editor::TransformSpace::World, bounds);
                auto d     = editor::identity();
                d["scale"] = kind == 4 ? editor::Json({0, 1, 1}) : editor::Json({2, 1, 1});
                editor::applySelectionEdits(s, editor::selectionEdits(s, f, d));
            }
            catch (...)
            {
                rejected = true;
            }
            require(rejected && s == original, "Invalid group transform mutated scene");
        }
        auto s = base;
        s["nodes"].push_back(
          {{"id", "parent"}, {"name", "Parent"}, {"parentId", nullptr}, {"transform", editor::identity()}});
        s["nodes"][2]["transform"]["scale"]    = {2, 2, 2};
        s["nodes"][2]["transform"]["rotation"] = editor::eulerQuaternion({0, 0, 90});
        s["nodes"][0]["parentId"]              = "parent";
        auto t                                 = editor::readNodeTransform(s, "left", editor::TransformSpace::World);
        t["position"]                          = {3, 4, 5};
        editor::writeNodeTransform(s, "left", editor::TransformSpace::World, t);
        auto world = editor::worldMatrices(s).at("left");
        require(
          std::abs(world[12] - 3) + std::abs(world[13] - 4) + std::abs(world[14] - 5) < 1e-4,
          "World numeric edit wrong");
        std::cout << "Selection contract: world/local group TRS, pivots, ray drags in both projections, parent "
                     "deduplication, atomic history, rejection and numeric coordinates passed\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
