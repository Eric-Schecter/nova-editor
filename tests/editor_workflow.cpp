#define NOVA_EDITOR_TEST
#include "../apps/desktop/src/main.cpp"
void require(bool v, const char* m)
{
    if (!v)
        throw std::runtime_error(m);
}
int main(int argc, char** argv)
{
    try
    {
        if (argc == 3 && std::string(argv[1]) == "--scene-preview")
        {
            Editor editor;
            const auto source = std::filesystem::absolute(argv[2]);
            editor.helperRoot = std::filesystem::absolute("resources/viewport");
            editor.assetRoot = std::filesystem::temp_directory_path() / uuid();
            std::filesystem::create_directories(editor.assetRoot);
            std::snprintf(editor.modelPath, sizeof(editor.modelPath), "%s", source.string().c_str());
            editor.importModel();
            const auto model = std::find_if(editor.history.scene["nodes"].begin(), editor.history.scene["nodes"].end(),
                [](const auto& node) { return node.contains("assetId"); });
            require(model != editor.history.scene["nodes"].end(), "Fixture has no renderable model");
            const auto id = model->at("id").get<std::string>();
            editor.change([](auto& scene) {
                scene["nodes"][0]["previewBehavior"] = {{"kind", "bob"}, {"amount", 1}};
            });
            render::WindowConfig config;
            config.width = 640;
            config.height = 480;
            config.title = "Nova scene preview verification";
            config.renderer.api = render::GraphicsAPI::Metal;
            editor::RenderWindow window(config);
            editor.window = &window;
            editor.syncScene();
            const auto authored = editor.history.scene;
            const auto original = window.GetSceneInstanceBounds(id);
            editor.toggleScenePreview();
            int frames = 0;
            for (int attempt = 0; attempt < 60 && frames < 8 && window.PollEvents(); ++attempt)
            {
                editor.advanceScenePreview(frames == 0 && editor.runtimeSeconds == 0 ? .25f : 0.f);
                if (window.DrawFrame() == render::FrameResult::Rendered) ++frames;
            }
            const auto posed = window.GetSceneInstanceBounds(id);
            editor.toggleScenePreview();
            const auto restored = window.GetSceneInstanceBounds(id);
            window.WaitIdle();
            require(frames == 8 && window.ValidationErrorCount() == 0, "Scene preview rendering failed");
            require(original && posed && restored &&
                std::abs(posed->minimum[1] - original->minimum[1] - 1.f) < .001f &&
                restored->minimum == original->minimum && editor.history.scene == authored,
                "Scene preview did not move and restore the model");
            std::filesystem::remove_all(editor.assetRoot);
            std::cout << "Scene preview: 8 Metal frames, model moved and restored, no validation errors\n";
            return 0;
        }
        if (argc == 5 && (std::string(argv[1]) == "--animated-export" ||
                          std::string(argv[1]) == "--lit-animated-export"))
        {
            const bool lit = std::string(argv[1]) == "--lit-animated-export";
            const auto source = std::filesystem::absolute(argv[2]);
            const auto output = std::filesystem::absolute(argv[3]);
            std::filesystem::create_directories(output);
            Editor editor;
            editor.helperRoot = std::filesystem::absolute(argv[4]);
            editor.assetRoot = output;
            std::string first;
            if (lit)
            {
                std::snprintf(editor.projectPath, sizeof(editor.projectPath), "%s", source.string().c_str());
                editor.open();
                first = "group";
            }
            else
            {
                std::snprintf(editor.modelPath, sizeof(editor.modelPath), "%s", source.string().c_str());
                editor.importModel();
                first = editor.selected;
                editor.change([&](auto& scene) {
                    auto duplicate = scene["nodes"][0];
                    duplicate["id"] = "second-rig";
                    duplicate["name"] = "Second Samba";
                    duplicate["transform"]["position"][0] = 180;
                    scene["nodes"].push_back(duplicate);
                });
            }
            const auto authored = editor.history.scene;
            const auto assetDirectory = editor.assetRoot;
            const auto load = [&](const std::string& path) {
                return editor::assets::readBytes(assetDirectory / path);
            };
            render::WindowConfig config;
            config.width = 960;
            config.height = 640;
            config.title = "Nova animated GLB export verification";
            config.renderer.api = render::GraphicsAPI::Metal;
            editor::RenderWindow window(config);
            editor.window = &window;
            for (bool selected : {true, false})
            {
                const auto path = output / (selected ? "selected.glb" : "scene.glb");
                const auto glb = editor::assets::exportGLB(authored, load,
                    selected ? std::optional<std::vector<std::string>>{{first}} : std::nullopt);
                const auto doc = editor::assets::readGLB(glb).json;
                const size_t count = (lit || selected) ? 1 : 2;
                require(doc["skins"].size() == count, "Export lost skins");
                require(doc["animations"].size() == count, "Export lost clips");
                if (lit)
                    require(doc["extensions"]["KHR_lights_punctual"]["lights"][0]["type"] == "spot", "Export lost spotlight");
                require(doc["skins"][0]["joints"].size() == 52, "Export lost joints");
                if (count == 2)
                    require(doc["skins"][0]["joints"][0] != doc["skins"][1]["joints"][0],
                        "Exported rigs share mutable joints");
                {
                    std::ofstream stream(path, std::ios::binary);
                    stream.write(reinterpret_cast<const char*>(glb.data()), glb.size());
                    require(bool(stream), "Cannot save exported GLB");
                }
                editor.history.replace(editor::emptyScene());
                editor.assetRoot = output;
                editor.select("");
                editor.playingAnimations.clear();
                std::snprintf(editor.modelPath, sizeof(editor.modelPath), "%s", path.string().c_str());
                editor.importModel();
                const auto actor = editor.selected;
                editor.syncScene();
                if (lit)
                {
                    editor.syncSceneObjects();
                    const auto lamps = window.GetLights();
                    require(lamps.size() == 1 && lamps[0].type == render::LightType::Spot &&
                        lamps[0].castShadow && std::abs(lamps[0].position[0] + 1.1f) < .001f &&
                        std::abs(lamps[0].intensity - 34.f) < .001f,
                        "Reimport did not restore the editable spotlight");
                }
                const auto before = window.GetSceneInstanceBounds(actor);
                auto state = window.GetAnimationState(actor);
                state.playing = true;
                window.SetAnimationState(actor, state);
                editor.playingAnimations.insert(actor);
                int frames = 0;
                for (int attempt = 0; attempt < 90 && frames < 20 && window.PollEvents(); ++attempt)
                {
                    editor.advanceAnimations(1.f / 24);
                    if (window.DrawFrame() == render::FrameResult::Rendered) ++frames;
                }
                window.WaitIdle();
                const auto after = window.GetSceneInstanceBounds(actor);
                require(frames == 20 && window.ValidationErrorCount() == 0 && before && after &&
                    (before->minimum != after->minimum || before->maximum != after->maximum) &&
                    window.GetAnimationState(actor).time > .6,
                    "Exported GLB did not animate after reimport");
                std::cout << path.filename().string() << ": 20 Metal frames, pose changed\n";
            }
            return 0;
        }
        if (argc == 5 && std::string(argv[1]) == "--fbx-playback")
        {
            const auto source = std::filesystem::absolute(argv[2]);
            const auto output = std::filesystem::absolute(argv[3]);
            std::filesystem::create_directories(output);
            Editor editor;
            editor.helperRoot = std::filesystem::absolute(argv[4]);
            editor.assetRoot = output;
            editor.importModel(source);
            const auto id = editor.selected;
            const auto assetId = editor.history.scene["nodes"][0]["assetId"].get<std::string>();
            render::WindowConfig config;
            config.width = 960;
            config.height = 640;
            config.title = "Nova FBX playback verification";
            config.renderer.api = render::GraphicsAPI::Metal;
            editor::RenderWindow window(config);
            editor.window = &window;
            editor.syncScene();
            require(!window.GetAnimations(assetId).empty(), "Converted FBX has no animation");
            const auto before = window.GetSceneInstanceBounds(id);
            auto state = window.GetAnimationState(id);
            state.playing = true;
            window.SetAnimationState(id, state);
            editor.playingAnimations.insert(id);
            int frames = 0;
            for (int attempt = 0; attempt < 150 && frames < 30 && window.PollEvents(); ++attempt)
            {
                editor.advanceAnimations(1.f / 30);
                if (window.DrawFrame() == render::FrameResult::Rendered) ++frames;
            }
            window.WaitIdle();
            const auto after = window.GetSceneInstanceBounds(id);
            require(frames == 30 && window.ValidationErrorCount() == 0, "Metal animation playback failed");
            require(window.GetAnimationState(id).time > .9f && before && after &&
                (before->minimum != after->minimum || before->maximum != after->maximum), "Animation did not move the pose");
            std::cout << "FBX playback: 30 Metal frames, animated bounds changed, validation errors 0\n";
            return 0;
        }
        if (argc == 5 && std::string(argv[1]) == "--fbx-roundtrip")
        {
            const auto source = std::filesystem::absolute(argv[2]);
            const auto output = std::filesystem::absolute(argv[3]);
            std::filesystem::create_directories(output);
            Editor editor;
            editor.helperRoot = std::filesystem::absolute(argv[4]);
            editor.assetRoot = output;
            const auto fbx = output / "model.fbx", glb = output / "model.glb";
            editor.importModel(source);
            editor.exportModel(fbx, 4, std::nullopt);
            editor.history.replace(editor::emptyScene());
            editor.importModel(fbx);
            editor.exportModel(glb, 0, std::nullopt);
            editor::saveProject(output / "project.json", editor.history.scene, output);
            std::cout << "FBX roundtrip and desktop reimport passed\n";
            return 0;
        }
        if (argc == 4 && std::string(argv[1]) == "--mesh-roundtrip")
        {
            const auto source = std::filesystem::absolute(argv[2]);
            const auto output = std::filesystem::absolute(argv[3]);
            std::filesystem::create_directories(output);
            Editor editor;
            editor.assetRoot = output;
            for (const auto* format : {"obj", "stl"})
            {
                editor.history.replace(editor::emptyScene());
                editor.importModel(source);
                const auto mesh = output / (std::string("helmet.") + format);
                const auto glb = output / (std::string("helmet-") + format + ".glb");
                editor.exportModel(mesh, std::string(format) == "obj" ? 1 : 2, std::nullopt);
                auto input = mesh;
                if (std::string(format) == "obj")
                {
                    input.replace_extension();
                    input /= "model.obj";
                }
                editor.history.replace(editor::emptyScene());
                editor.importModel(input);
                editor.exportModel(glb, 0, std::nullopt);
                const auto expected = editor::assets::parseMesh(editor::assets::glbToMesh(editor::assets::readBytes(source), true), true);
                const auto actual = editor::assets::parseMesh(editor::assets::glbToMesh(editor::assets::readBytes(glb), true), true);
                require(expected == actual, "Mesh roundtrip changed triangle positions");
                if (std::string(format) == "obj")
                {
                    const auto a = editor::assets::glbToOBJ(editor::assets::readBytes(source));
                    const auto b = editor::assets::glbToOBJ(editor::assets::readBytes(glb));
                    for (const auto& [name, bytes] : a)
                        if (name != "model.obj" && name != "model.mtl")
                            require(b.at(name) == bytes, "OBJ roundtrip changed texture bytes");
                    const auto doc = editor::assets::readGLB(editor::assets::readBytes(glb)).json;
                    require(doc["meshes"][0]["primitives"][0]["attributes"].contains("TEXCOORD_0"),
                            "OBJ roundtrip lost UVs");
                }
                std::cout << format << ": " << actual.size() << " triangles preserved\n";
            }
            editor::saveProject(output / "project.json", editor.history.scene, output);
            return 0;
        }
        if (argc == 3)
        {
            const auto source = std::filesystem::absolute(argv[1]);
            const auto output = std::filesystem::absolute(argv[2]);
            std::filesystem::create_directories(output);
            Editor editor;
            editor.assetRoot = output;
            const auto first = output / "first.glb", unpacked = output / "unpacked", final = output / "repacked.glb";
            editor.importModel(source);
            editor.exportModel(first, 0, std::nullopt);
            editor.exportModel(output / "unpacked.gltf", 3, std::nullopt);
            editor.history.replace(editor::emptyScene());
            editor.importModel(unpacked / "model.gltf");
            editor.exportModel(final, 0, std::nullopt);
            require(editor.history.scene["nodes"].size() == 1, "Reimport did not add the animated model");
            editor::saveProject(output / "project.json", editor.history.scene, output);
            std::cout << "Desktop editor conversion, reimport and save passed: " << final << '\n';
            return 0;
        }
        auto root = std::filesystem::temp_directory_path() / ("nova-editor-workflow-" + uuid());
        std::filesystem::create_directories(root / "assets");
        Editor e;
        e.recoveryBase = root / "recoveries";
        e.scanRecovery();
        std::snprintf(e.projectPath, sizeof(e.projectPath), "%s", (root / "project.json").string().c_str());
        e.add();
        const auto first = e.selected;
        e.select("");
        e.add();
        const auto second = e.selected;
        e.selectMany({first, second});
        e.treeCommand("group");
        require(
          e.history.scene["nodes"].size() == 3 && e.selections.size() == 1 && e.dirty(), "editor batch group failed");
        auto grouped = e.history.scene;
        e.autosave(true);
        require(editor::readRecovery(e.recoveryFolder).scene == grouped, "autosave missing");
        e.history.undo();
        require(e.history.scene["nodes"].size() == 2, "group undo failed");
        e.history.redo();
        require(e.history.scene == grouped, "group redo failed");
        e.save();
        require(!e.dirty() && !std::filesystem::exists(e.recoveryFolder), "save did not clear dirty/recovery");
        e.treeCommand("duplicate");
        auto changed = e.history.scene;
        e.autosave(true);
        auto   oldFolder = e.recoveryFolder;
        Editor recovered;
        recovered.recoveryBase = e.recoveryBase;
        recovered.scanRecovery();
        require(recovered.recoveries.size() == 1, "startup did not discover recovery");
        recovered.restoreRecovery(oldFolder);
        require(recovered.history.scene == changed && recovered.dirty(), "recovery not dirty or lost edits");
        recovered.save();
        require(editor::read(root / "project.json") == changed && !recovered.dirty(), "recovered save failed");
        // Open protection: asking to open doesn't mutate the current document or saved baseline.
        auto other    = editor::emptyScene();
        other["name"] = "Other";
        editor::save(root / "other.json", other);
        recovered.add();
        auto unsaved = recovered.history.scene;
        std::snprintf(
          recovered.projectPath, sizeof(recovered.projectPath), "%s", (root / "other.json").string().c_str());
        recovered.open();
        require(recovered.showUnsaved && recovered.history.scene == unsaved, "open discarded edits without prompt");
        recovered.finishRequest(true);
        require(recovered.history.scene == other && !recovered.dirty(), "save-and-open failed");
        require(editor::read(root / "project.json") == unsaved, "save-and-open saved to wrong path");
        recovered.add();
        recovered.showUnsaved  = true;
        recovered.requestClose = true;
        recovered.finishRequest(true);
        require(recovered.exitApproved && !recovered.dirty(), "save-and-close failed");
        Editor broken;
        broken.recoveryBase = root / "broken-recovery";
        broken.scanRecovery();
        std::snprintf(broken.projectPath, sizeof(broken.projectPath), "%s", (root / "protected.json").string().c_str());
        broken.add();
        broken.history.scene["assets"]["missing"] = {{"path", "assets/missing.glb"}};
        auto baseline                             = broken.saved;
        broken.requestClose                       = true;
        broken.showUnsaved                        = true;
        bool failed                               = false;
        try
        {
            broken.finishRequest(true);
        }
        catch (...)
        {
            failed = true;
        }
        require(
          failed && broken.dirty() && !broken.exitApproved && broken.saved == baseline && broken.showUnsaved,
          "failed save allowed close or marked clean");
        Editor fresh;
        fresh.recoveryBase = root / "new-recovery";
        fresh.scanRecovery();
        std::snprintf(fresh.projectPath, sizeof(fresh.projectPath), "%s", (root / "project.json").string().c_str());
        fresh.open();
        fresh.add();
        auto beforeNew = fresh.history.scene;
        fresh.newProject();
        require(fresh.showUnsaved && fresh.history.scene == beforeNew, "new project discarded dirty document");
        fresh.finishRequest(true);
        require(fresh.history.scene["nodes"].empty() && !fresh.dirty(), "save-and-new failed");
        require(editor::read(root / "project.json") == beforeNew, "save-and-new did not save original");
        require(std::filesystem::path(fresh.projectPath) != root / "project.json", "new project reused original path");
        Editor assetEditor;
        assetEditor.recoveryBase = root / "asset-recovery";
        assetEditor.scanRecovery();
        std::snprintf(
          assetEditor.projectPath,
          sizeof(assetEditor.projectPath),
          "%s",
          (root / "asset-project/project.json").string().c_str());
        assetEditor.createPrimitive("box");
        auto originalNode  = assetEditor.selected;
        auto originalAsset = editor::nodeById(assetEditor.history.scene, originalNode)["assetId"].get<std::string>();
        assetEditor.treeCommand("duplicate");
        auto duplicate = assetEditor.selected;
        require(
          editor::nodeById(assetEditor.history.scene, duplicate)["assetId"] == originalAsset,
          "duplicate did not share asset");
        auto beforeAssetEdit = assetEditor.history.scene;
        auto edited          = assetEditor.selectedAsset(duplicate);
        auto factors         = editor::assets::materialData(edited);
        factors["color"]     = {.9, .1, .2};
        edited               = editor::assets::applyMaterial(edited, factors);
        assetEditor.writeAssetVersion(duplicate, editor::assets::writeGLB(edited));
        auto sharedPath = assetEditor.history.scene["assets"][originalAsset]["path"].get<std::string>();
        assetEditor.history.undo();
        require(assetEditor.history.scene == beforeAssetEdit, "material undo did not restore asset reference");
        assetEditor.history.redo();
        assetEditor.makeAssetUnique(duplicate);
        require(
          editor::nodeById(assetEditor.history.scene, duplicate)["assetId"] != originalAsset,
          "make unique still shares resource");
        auto geometry                   = editor::assets::defaultGeometry("box");
        geometry["parameters"]["width"] = 3;
        auto doc = editor::assets::regenerateGeometry(assetEditor.selectedAsset(duplicate), geometry);
        assetEditor.writeAssetVersion(duplicate, editor::assets::writeGLB(doc));
        require(
          assetEditor.history.scene["assets"][originalAsset]["path"] == sharedPath,
          "independent edit changed original");
        auto current = assetEditor.history.scene;
        std::snprintf(
          assetEditor.projectPath,
          sizeof(assetEditor.projectPath),
          "%s",
          (root / "asset-save-as/project.json").string().c_str());
        assetEditor.save();
        assetEditor.history.undo();
        editor::verifyAssets(assetEditor.history.scene, assetEditor.assetRoot);
        assetEditor.history.redo();
        require(assetEditor.history.scene == current, "save as damaged geometry redo");
        auto restoredDoc = assetEditor.selectedAsset(duplicate);
        require(
          *editor::assets::geometryData(restoredDoc) == geometry
            && editor::assets::materialData(restoredDoc) == factors,
          "geometry/PBR missing after save as");
        Editor modelEditor;
        modelEditor.recoveryBase = root / "model-recovery";
        modelEditor.scanRecovery();
        std::snprintf(
          modelEditor.projectPath,
          sizeof(modelEditor.projectPath),
          "%s",
          (root / "model-project/project.json").string().c_str());
        std::snprintf(
          modelEditor.modelPath,
          sizeof(modelEditor.modelPath),
          "%s",
          (std::filesystem::path(__FILE__).parent_path() / "fixtures/model-parts.glb").string().c_str());
        modelEditor.importModel();
        auto modelScene = modelEditor.history.scene;
        auto modelRoot  = modelEditor.selected;
        require(
          modelScene["nodes"].size() == 9 && modelScene["assets"].size() == 3,
          "Real import did not expand nodes/slots");
        modelEditor.history.undo();
        require(modelEditor.history.scene["nodes"].empty(), "Model import was not one undo");
        modelEditor.history.redo();
        std::vector<std::string> slots;
        for (const auto& n : modelScene["nodes"])
            if (n.contains("assetId"))
                slots.push_back(n["id"]);
        auto otherSlot = modelEditor.selectedAsset(slots[1]);
        auto red       = modelEditor.selectedAsset(slots[0]);
        auto mat       = editor::assets::materialData(red);
        mat["color"]   = {.2, .7, .1};
        red            = editor::assets::applyMaterial(red, mat);
        modelEditor.writeAssetVersion(slots[0], editor::assets::writeGLB(red));
        require(
          editor::assets::writeGLB(modelEditor.selectedAsset(slots[1])) == editor::assets::writeGLB(otherSlot),
          "Editing one slot changed another");
        modelEditor.select(slots[0]);
        modelEditor.change([&](auto& document) {
            for (auto& n : document["nodes"])
                if (n["id"] == slots[0])
                    n["transform"]["position"][0] = .3;
        });
        auto editedModel = modelEditor.history.scene;
        modelEditor.save();
        modelEditor.autosave(true);
        modelEditor.history.undo();
        editor::verifyAssets(modelEditor.history.scene, modelEditor.assetRoot);
        modelEditor.history.redo();
        Editor reopen;
        std::snprintf(reopen.projectPath, sizeof(reopen.projectPath), "%s", modelEditor.projectPath);
        reopen.open();
        require(
          reopen.history.scene == editedModel && editor::assets::materialData(reopen.selectedAsset(slots[0])) == mat,
          "Model slots/transform/material lost on reopen");
        Editor legacy;
        legacy.assetRoot = root / "legacy-model";
        std::filesystem::create_directories(legacy.assetRoot / "assets");
        auto original =
          editor::assets::readBytes(std::filesystem::path(__FILE__).parent_path() / "fixtures/model-parts.glb");
        legacy.writeModelFiles({{"assets/original.glb", original}});
        auto oldScene             = editor::emptyScene();
        oldScene["assets"]["old"] = {{"path", "assets/original.glb"}, {"sourceSpace", false}};
        oldScene["nodes"].push_back(
          {{"id", "old"},
           {"name", "Old"},
           {"parentId", nullptr},
           {"assetId", "old"},
           {"transform", editor::identity()}});
        legacy.history.replace(oldScene);
        legacy.expandSelectedModel("old");
        require(legacy.history.scene["nodes"].size() == 10, "Existing model expansion lost normalization");
        legacy.history.undo();
        require(legacy.history.scene == oldScene, "Existing expansion undo lost original asset");
        editor::verifyAssets(legacy.history.scene, legacy.assetRoot);
        modelEditor.selectMany({slots[0], slots[1]});
        auto beforeGroup = modelEditor.history.scene;
        auto groupFrame  = editor::selectionFrame(
          beforeGroup, modelEditor.selections, modelEditor.selected, editor::TransformSpace::World);
        auto groupDelta        = editor::identity();
        groupDelta["position"] = {2, 1, -1};
        groupDelta["rotation"] = editor::eulerQuaternion({0, 35, 0});
        groupDelta["scale"]    = {1.5, 1.5, 1.5};
        modelEditor.change([&](auto& s) {
            editor::applySelectionEdits(s, editor::selectionEdits(beforeGroup, groupFrame, groupDelta));
        });
        auto afterGroup = modelEditor.history.scene;
        modelEditor.history.undo();
        require(modelEditor.history.scene == beforeGroup, "Group transform undo lost selection transforms");
        modelEditor.history.redo();
        require(modelEditor.history.scene == afterGroup, "Group transform redo failed");
        std::snprintf(
          modelEditor.projectPath,
          sizeof(modelEditor.projectPath),
          "%s",
          (root / "group-save-as/project.json").string().c_str());
        modelEditor.save();
        Editor groupReopen;
        std::snprintf(groupReopen.projectPath, sizeof(groupReopen.projectPath), "%s", modelEditor.projectPath);
        groupReopen.open();
        require(groupReopen.history.scene == afterGroup, "Group transforms lost on save/reopen");
        modelEditor.addSceneObject("camera");
        auto camera1 = modelEditor.selected;
        modelEditor.treeCommand("duplicate");
        auto camera2 = modelEditor.selected;
        modelEditor.change([&](auto& s) {
            editor::setPrimary(s, camera2, "camera");
            for (auto& n : s["nodes"])
                if (n["id"] == camera2)
                {
                    n["camera"]["projection"]       = "orthographic";
                    n["camera"]["orthographicSize"] = 6;
                }
        });
        modelEditor.addSceneObject("light");
        auto sun = modelEditor.selected;
        modelEditor.change([&](auto& s) {
            for (auto& n : s["nodes"])
                if (n["id"] == sun)
                {
                    n["light"]["color"]     = {1, .5, .2};
                    n["light"]["intensity"] = 6;
                    n["light"]["softness"]  = 3;
                }
        });
        modelEditor.createPrimitive("box");
        require(modelEditor.history.scene["schemaVersion"] == 6, "Geometry creation downgraded scene v6");
        auto objects = modelEditor.history.scene;
        modelEditor.autosave(true);
        auto   objectRecovery = modelEditor.recoveryFolder;
        Editor recoveredObjects;
        recoveredObjects.recoveryBase = modelEditor.recoveryBase;
        recoveredObjects.scanRecovery();
        recoveredObjects.restoreRecovery(objectRecovery);
        require(recoveredObjects.history.scene == objects, "Recovery lost camera/light components");
        std::snprintf(
          recoveredObjects.projectPath,
          sizeof(recoveredObjects.projectPath),
          "%s",
          (root / "objects-save/project.json").string().c_str());
        recoveredObjects.save();
        Editor reopenObjects;
        std::snprintf(reopenObjects.projectPath, sizeof(reopenObjects.projectPath), "%s", recoveredObjects.projectPath);
        reopenObjects.open();
        require(
          reopenObjects.history.scene == objects && editor::primaryCamera(reopenObjects.history.scene) == camera2
            && editor::sceneCamera(reopenObjects.history.scene)->orthographic,
          "Save/reopen lost main camera");
        require(
          editor::sceneDirectional(reopenObjects.history.scene)->light.intensity == 6, "Save/reopen lost scene light");
        std::filesystem::remove_all(root);
        std::cout << "Editor workflow: multi-selection/group/history, autosave/recover/save, save-and-open path, "
                     "save-and-close, failed-save close protection passed\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
