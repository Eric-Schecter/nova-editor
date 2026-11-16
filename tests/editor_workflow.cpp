#define NOVA_EDITOR_TEST
#include "../apps/desktop/src/main.cpp"
void require(bool v, const char* m)
{
    if (!v)
        throw std::runtime_error(m);
}
int main()
{
    try
    {
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
        require(modelEditor.history.scene["schemaVersion"] == 3, "Geometry creation downgraded scene v3");
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
