#include "../apps/desktop/src/RenderBridge.hpp"
#define NOVA_EDITOR_TEST
#include "../apps/desktop/src/main.cpp"
int main(int argc, char** argv)
{
    std::filesystem::path root;
    try
    {
        if (argc != 3)
            throw std::runtime_error("Usage: editor_layout_render_test <viewport resources> <triangle.glb>");
        const auto helpers = std::filesystem::absolute(argv[1]), triangle = std::filesystem::absolute(argv[2]);
        root = std::filesystem::temp_directory_path() / ("nova-layout-render-" + uuid());
        std::filesystem::create_directories(root / "assets");
        std::filesystem::copy_file(triangle, root / "assets/triangle.glb");
        Editor e;
        e.helperRoot   = helpers;
        e.assetRoot    = root;
        e.recoveryBase = root / "recovery";
        e.scanRecovery();
        auto scene              = editor::emptyScene();
        scene["name"]           = "Layout smoke";
        scene["assets"]["mesh"] = {{"path", "assets/triangle.glb"}, {"sourceSpace", true}};
        scene["nodes"].push_back(
          {{"id", "mesh"},
           {"name", "Triangle"},
           {"parentId", nullptr},
           {"assetId", "mesh"},
           {"transform", editor::identity()}});
        e.history.replace(scene);
        e.saved = scene;
        e.select("mesh");
        std::snprintf(e.projectPath, sizeof(e.projectPath), "%s", (root / "project.json").string().c_str());
        std::map<std::string, std::string> primitiveNodes;
        int                                primitiveIndex = 0;
        for (const auto& [type, parameters] : editor::assets::primitives())
        {
            e.createPrimitive(type);
            primitiveNodes[type] = e.selected;
            auto      id         = e.selected;
            const int i          = primitiveIndex++;
            e.change([&](auto& document) {
                for (auto& node : document["nodes"])
                    if (node["id"] == id)
                    {
                        node["transform"]["position"][0] = (i % 3 - 1) * 3.5;
                        node["transform"]["position"][2] = (i / 3) * 3.5;
                    }
            });
        }
        auto plane       = primitiveNodes.at("plane");
        auto materialDoc = e.selectedAsset(plane);
        materialDoc      = editor::assets::applyTexture(
          materialDoc, "baseColor", editor::assets::readBytes(triangle.parent_path() / "checker.png"));
        e.writeAssetVersion(plane, editor::assets::writeGLB(materialDoc));
        std::snprintf(
          e.modelPath, sizeof(e.modelPath), "%s", (triangle.parent_path() / "model-parts.glb").string().c_str());
        e.importModel();
        auto modelRoot = e.selected;
        e.change([&](auto& document) {
            for (auto& n : document["nodes"])
                if (n["id"] == modelRoot)
                    n["transform"]["position"] = {8, 0, 0};
        });
        std::vector<std::string> modelSlots;
        for (const auto& n : e.history.scene["nodes"])
            if (n.contains("assetId") && editor::subtreeIds(e.history.scene, {modelRoot}).count(n["id"]))
                modelSlots.push_back(n["id"]);
        e.saved                 = e.history.scene;
        e.editorCamera.yaw      = 25;
        e.editorCamera.pitch    = 20;
        e.editorCamera.distance = 12;
        e.editorCamera.target   = {0, 1, 0};
        e.addSceneObject("camera");
        auto cameraFront     = e.selected;
        e.editorCamera.yaw   = 90;
        e.editorCamera.pitch = 15;
        e.addSceneObject("camera");
        auto cameraSide = e.selected;
        e.change([&](auto& s) {
            for (auto& n : s["nodes"])
                if (n["id"] == cameraSide)
                {
                    n["camera"]["projection"]       = "orthographic";
                    n["camera"]["orthographicSize"] = 7;
                }
        });
        e.addSceneObject("light");
        auto sceneSun = e.selected;
        e.saved       = e.history.scene;
        render::WindowConfig config;
        config.width  = 1440;
        config.height = 900;
        config.title  = "Nova layout render test";
        editor::RenderWindow window(config);
        e.window = &window;
        window.SetClearColor({.6f, .6f, .6f, 1});
        window.SetLighting(render::LightingMode::PBR);
        window.SetDirectionalLight(e.studio.light());
        window.EnableOrbitControls(false);
        window.SetCloseOnEscape(false);
        const auto                   framebuffer = window.GetFramebufferSize();
        const float                  dpi         = std::max(1.f, float(framebuffer[0]) / config.width);
        render::ParameterPanelConfig panel;
        panel.showBuiltinPanel = false;
        panel.configureUI      = [dpi] { editor::theme::configure(dpi); };
        panel.sceneViewport    = [&] { return e.viewportRect; };
        int frames             = 0;
        panel.drawUI           = [&] {
            e.sidebarTab        = frames < 120 ? (frames / 30) % 3 : 0;
            e.assetsOpen        = (frames / 15) % 2;
            e.lightInspector    = frames >= 90 && frames < 120;
            e.assetInspectorTab = frames >= 120 && frames < 180 ? 2 : frames < 180 ? 0 : frames < 240 ? 1 : 2;
            if (frames >= 300)
                e.assetInspectorTab = 0;
            e.draw();
            if (e.viewportRect[0] != 0 || e.viewportRect[2] <= 0 || e.viewportRect[3] <= 0)
                throw std::runtime_error("Invalid viewport rectangle");
        };
        if (!window.EnableParameterPanel(panel))
            throw std::runtime_error("UI support required");
        e.pendingFocus = "*";
        e.syncScene();
        auto left  = window.PickScene({{7.35f, 1.25f, 5}, {0, 0, -1}}),
             right = window.PickScene({{8.65f, 1.25f, 5}, {0, 0, -1}});
        if (!left || !right || left->id == right->id)
            throw std::runtime_error("Native submesh picking failed");
        e.syncSceneObjects();
        bool                regenerated = false;
        editor::OrbitCamera savedEditorView;

        while (window.PollEvents() && frames < 720)
        {
            if (frames == 120)
            {
                e.select(modelRoot);
                e.prepareAssetInspector();
            }
            if (frames == 150)
            {
                e.select(modelSlots[0]);
                auto doc   = e.selectedAsset(modelSlots[0]);
                auto m     = editor::assets::materialData(doc);
                m["color"] = {.1, .7, .05};
                doc        = editor::assets::applyMaterial(doc, m);
                e.writeAssetVersion(modelSlots[0], editor::assets::writeGLB(doc));
                e.saved = e.history.scene;
            }
            if (frames == 180)
            {
                e.select(plane);
                e.prepareAssetInspector();
            }
            if (frames >= 270 && !regenerated)
            {
                auto document                   = e.selectedAsset(plane);
                auto geometry                   = *editor::assets::geometryData(document);
                geometry["parameters"]["width"] = 4;
                document                        = editor::assets::regenerateGeometry(document, geometry);
                auto material                   = editor::assets::materialData(document);
                material["metallic"]            = .35;
                material["roughness"]           = .25;
                document                        = editor::assets::applyMaterial(document, material);
                e.writeAssetVersion(plane, editor::assets::writeGLB(document));
                e.saved = e.history.scene;
                e.flush();
                regenerated = true;
            }

            if (frames == 300)
            {
                e.selectMany({modelSlots[0], modelSlots[1]});
                e.tools.space = editor::TransformSpace::World;
                e.tools.mode  = editor::Tool::Translate;
            }
            if (frames == 305)
            {
                auto next  = e.history.scene;
                auto frame = editor::selectionFrame(next, e.selections, e.selected, e.tools.space, e.assetBounds);
                auto delta = editor::identity();
                delta["position"] = {0, .3, 0};
                delta["rotation"] = editor::eulerQuaternion({0, 30, 0});
                delta["scale"]    = {1.2, 1.2, 1.2};
                editor::applySelectionEdits(next, editor::selectionEdits(e.history.scene, frame, delta));
                e.history.commit(next);
                e.saved = e.history.scene;
            }
            if (frames == 330)
                e.history.undo();
            if (frames == 340)
            {
                e.history.redo();
                e.saved = e.history.scene;
            }
            if (frames == 360)
            {
                e.tools.space = editor::TransformSpace::Local;
                e.tools.mode  = editor::Tool::Rotate;
            }
            if (frames == 390)
                e.tools.mode = editor::Tool::Scale;
            if (frames == 420)
            {
                auto c         = window.GetCamera();
                c.orthographic = true;
                window.SetCamera(c);
            }
            if (frames == 450)
            {
                e.select(modelSlots[0]);
                e.tools.space = editor::TransformSpace::World;
            }
            if (frames == 480)
            {
                e.select(sceneSun);
                e.change([&](auto& s) {
                    editor::aimObject(s, sceneSun, -50, 40);
                    for (auto& n : s["nodes"])
                        if (n["id"] == sceneSun)
                        {
                            n["light"]["color"]     = {1, .6, .3};
                            n["light"]["intensity"] = 6;
                            n["light"]["softness"]  = 3;
                        }
                });
            }
            if (frames == 500)
            {
                savedEditorView = window.GetCamera();
                e.toggleMainPreview();
            }
            if (frames == 515)
            {
                const auto lights = window.GetLights();
                const bool sceneLightApplied = std::any_of(lights.begin(), lights.end(), [&](const auto& light) {
                    return light.id == sceneSun && light.enabled && light.intensity == 6;
                });
                if (!e.mainPreview || std::abs(window.GetCamera().yaw - 25) > 1e-3 || !sceneLightApplied)
                    throw std::runtime_error("Scene camera / light not applied to SDK");
            }
            if (frames == 540)
                e.change([&](auto& s) { editor::setPrimary(s, cameraSide, "camera"); });
            if (frames == 550 && !window.GetCamera().orthographic)
                throw std::runtime_error("Primary orthographic camera switch failed");
            if (frames == 560)
                e.change([&](auto& s) { editor::aimObject(s, cameraSide, 20, 30); });
            if (frames == 580)
            {
                e.toggleMainPreview();
                auto c = window.GetCamera();
                if (
                  std::abs(c.yaw - savedEditorView.yaw) > 1e-4
                  || std::abs(c.distance - savedEditorView.distance) > 1e-4)
                    throw std::runtime_error("Editor camera was overwritten by scene preview");
            }
            if (frames == 600)
            {
                e.select(cameraSide);
                e.frame(cameraSide);
            }
            if (frames == 620)
                e.change([&](auto& s) { editor::captureCamera(s, cameraSide, e.editorCamera); });
            if (frames == 640)
            {
                e.select(cameraSide);
                e.treeCommand("delete");
                e.history.undo();
                e.select(cameraSide);
            }
            if (frames == 660)
            {
                e.change([&](auto& s) { editor::setPrimary(s, cameraFront, "camera"); });
                e.toggleMainPreview();
            }
            if (frames == 680)
                e.change([&](auto& s) {
                    for (auto& n : s["nodes"])
                        if (n["id"] == cameraFront)
                            n["transform"]["rotation"] = editor::eulerQuaternion({0, 0, 30});
                });
            if (frames == 690 && (!e.mainPreview || std::abs(window.GetCamera().roll - 30) > 1e-3))
                throw std::runtime_error("Scene camera roll was not rendered");
            if (frames == 700)
            {
                e.change([&](auto& s) { editor::captureCamera(s, cameraFront, e.editorCamera); });
                e.select(cameraFront);
                e.toggleMainPreview();
            }
            if (window.DrawFrame() == render::FrameResult::Rendered)
                frames++;
            e.flush();
#ifdef NOVA_EDITOR_WINDOW_HOST_CONTROLS
            if (frames == 90)
                window.SetSize(900, 640);
#else
            if (frames == 90 && e.nativeHandle)
                glfwSetWindowSize(e.nativeHandle, 900, 640);
#endif
        }
        window.WaitIdle();
        if (frames != 720 || window.ValidationErrorCount())
            throw std::runtime_error("Layout rendering did not finish cleanly");
        std::filesystem::remove_all(root);
        std::cout
          << "720 Metal frames: saved light/camera nodes, main switching, orthographic preview, editor return, "
             "rolled camera preview; group local/world TRS, numeric fields, undo/redo, orthographic view; internal "
             "nodes, independent material slots, submesh picking, PBR/embedded textures, "
             "viewport resize; validation errors: 0\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        if (!root.empty())
            std::filesystem::remove_all(root);
        return 1;
    }
}
