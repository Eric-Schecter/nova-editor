#include "AssetInspector.hpp"
#include "Hierarchy.hpp"
#include "Lighting.hpp"
#include "ModelEditing.hpp"
#include "Persistence.hpp"
#include "SceneObjectInspector.hpp"
#include "WorldInspector.hpp"
#define GLFW_INCLUDE_NONE
#include "Navigation.hpp"
#include "Scene.hpp"
#include "Theme.hpp"
#include "Transforms.hpp"
#include "Viewport.hpp"
#include <GLFW/glfw3.h>
#include <chrono>
#include <functional>
#include <imgui.h>
#include <iomanip>
#include <iostream>
#include <random>
#include <render/Window.hpp>
#include <sstream>

static std::string uuid()
{
    std::random_device rd;
    unsigned char      bytes[16];
    for (auto& b : bytes)
        b = static_cast<unsigned char>(rd());
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    std::ostringstream out;
    for (int i = 0; i < 16; ++i)
    {
        if (i == 4 || i == 6 || i == 8 || i == 10)
            out << '-';
        out << std::hex << std::setw(2) << std::setfill('0') << int(bytes[i]);
    }
    return out.str();
}
struct Editor
{
    editor::History        history;
    editor::ViewportTools  tools;
    editor::AssetBounds    assetBounds;
    std::array<float, 4>   viewportRect{0, 24, 1110, 821};
    std::string            pendingFocus;
    bool                   lit               = true;
    bool                   lightInspector    = false;
    int                    assetInspectorTab = 0;
    editor::AssetInspector assetInspector;
    editor::WorldInspector worldInspector;
    std::string            environmentKey;
    int                    sidebarTab = 0;
    bool                   assetsOpen = false, focusProjectPath = false, focusModelPath = false;
    float                  scenePanelHeight = 285;

    editor::StudioSettings studio;
    editor::Json           saved = editor::emptyScene();
    std::string            selected, status = "Ready", preview;
    char                   projectPath[1024] = "output/workspace/project.json", modelPath[1024] = "", name[256] = "";
    std::vector<std::function<void()>>    pending;
    render::Window*                       window = nullptr;
    std::filesystem::path                 assetRoot, helperRoot;
    editor::Json                          renderDocument;
    std::string                           renderRoot;
    std::vector<std::string>              selections;
    char                                  search[256] = "";
    std::string                           anchor, recoveryStatus = "Recovery ready", currentProjectPath;
    std::filesystem::path                 recoveryBase = editor::defaultRecoveryRoot(), recoveryFolder;
    std::vector<std::filesystem::path>    recoveries;
    editor::Json                          observed, recoveredSnapshot;
    std::chrono::steady_clock::time_point changedAt       = std::chrono::steady_clock::now();
    GLFWwindow*                           nativeHandle    = nullptr;
    bool                                  renameRequested = false, nameDraftDirty = false;
    bool                                  requestClose = false, exitApproved = false, showUnsaved = false;
    std::string                           requestedOpen;
    bool                                  requestedNew = false, recoveryDismissed = false;
    bool                                  dirty() const { return history.scene != saved; }
    void                                  action(std::function<void()> fn) { pending.push_back(std::move(fn)); }
    void                                  select(const std::string& id)
    {
        if (history.previewBase)
            history.cancelPreview();
        nameDraftDirty = false;
        selected       = id;
        selections     = id.empty() ? std::vector<std::string>{} : std::vector<std::string>{id};
        for (const auto& n : history.scene["nodes"])
            if (n["id"] == id)
            {
                if (n.contains("camera") || n.contains("light"))
                {
                    assetInspectorTab = 0;
                    lightInspector    = false;
                }
                std::snprintf(name, sizeof(name), "%s", n["name"].get<std::string>().c_str());
            }
    }
    void change(std::function<void(editor::Json&)> edit)
    {
        history.cancelPreview();
        auto s = history.scene;
        edit(s);
        history.commit(s);
    }
    void selectMany(const std::vector<std::string>& ids)
    {
        select(ids.empty() ? "" : ids.back());
        selections = ids;
        if (ids.size() > 1)
        {
            assetInspectorTab = 0;
            lightInspector    = false;
        }
    }
    void add()
    {
        auto id = uuid();
        change([&](auto& s) {
            s["nodes"].push_back(
              {{"id", id},
               {"name", "Empty"},
               {"parentId",
                selected.empty() || editor::inheritedFlag(s, selected, "locked") ? editor::Json(nullptr)
                                                                                 : editor::Json(selected)},
               {"transform", editor::identity()}});
        });
        select(id);
    }
    std::filesystem::path projectRoot()
    {
        auto p = std::filesystem::absolute(projectPath).parent_path();
        std::filesystem::create_directories(p);
        return p;
    }
    std::filesystem::path resolveAsset(const std::filesystem::path& root, const std::string& path)
    {
        auto base = std::filesystem::weakly_canonical(root);
        auto full = std::filesystem::weakly_canonical(root / path);
        auto rel  = full.lexically_relative(base);
        if (rel.empty() || *rel.begin() == "..")
            throw std::runtime_error("Asset escapes project directory");
        return full;
    }
    void commitNameDraft()
    {
        if (selected.empty() || !nameDraftDirty)
            return;
        nameDraftDirty = false;
        for (const auto& n : history.scene["nodes"])
            if (
              n["id"] == selected && !editor::inheritedFlag(history.scene, selected, "locked")
              && n["name"] != std::string(name))
            {
                auto id = selected, value = std::string(name);
                if (value.find_first_not_of(" \t\r\n") != std::string::npos)
                    change([&](auto& draft) {
                        for (auto& item : draft["nodes"])
                            if (item["id"] == id)
                                item["name"] = value;
                    });
                break;
            }
    }
    void save()
    {
        if (history.previewBase)
            throw std::runtime_error("Finish the current drag before saving");
        commitNameDraft();
        const auto            dest         = projectRoot();
        auto                  dependencies = history.scene;
        std::set<std::string> paths        = editor::projectPaths(dependencies);
        for (const auto* snapshots : {&history.past, &history.future})
            for (const auto& snapshot : *snapshots)
            {
                auto more = editor::projectPaths(snapshot);
                paths.insert(more.begin(), more.end());
            }
        auto source = assetRoot.empty() ? dest : assetRoot;
        editor::copyAssets(history.scene, source, dest);
        for (const auto& path : paths)
        {
            auto from = resolveAsset(source, path), to = resolveAsset(dest, path);
            if (from != to)
            {
                std::filesystem::create_directories(to.parent_path());
                std::filesystem::copy_file(from, to, std::filesystem::copy_options::overwrite_existing);
            }
        }
        editor::save(projectPath, history.scene);
        assetRoot          = dest;
        saved              = history.scene;
        currentProjectPath = std::filesystem::absolute(projectPath).string();
        status             = "Saved project";
        clearOwnRecovery();
    }
    void clearOwnRecovery()
    {
        if (!recoveryFolder.empty() && std::filesystem::exists(recoveryFolder))
            std::filesystem::remove_all(recoveryFolder);
        recoveredSnapshot = nullptr;
        recoveryStatus    = "Project saved";
    }
    void writeAssetVersion(const std::string& nodeId, const editor::assets::Bytes& bytes)
    {
        editor::assertEditable(history.scene, {nodeId});
        auto assetId = editor::nodeById(history.scene, nodeId).at("assetId").get<std::string>();
        if (assetRoot.empty())
            assetRoot = projectRoot();
        auto relative = "assets/" + uuid() + ".glb";
        auto path     = resolveAsset(assetRoot, relative);
        std::filesystem::create_directories(path.parent_path());
        {
            std::ofstream f(path, std::ios::binary);
            f.write(reinterpret_cast<const char*>(bytes.data()), std::streamsize(bytes.size()));
            f.close();
            if (!f)
                throw std::runtime_error("Cannot write asset version");
        }
        change([&](auto& draft) { draft["assets"][assetId]["path"] = relative; });
        assetInspector.key.clear();
        status = "Asset updated; undo available";
    }
    editor::assets::GLB selectedAsset(const std::string& nodeId)
    {
        auto id   = editor::nodeById(history.scene, nodeId).at("assetId").get<std::string>();
        auto path = history.scene["assets"][id]["path"].get<std::string>();
        return editor::assets::readGLB(
          editor::assets::readBytes(resolveAsset(assetRoot.empty() ? projectRoot() : assetRoot, path)));
    }
    void createPrimitive(const std::string& type)
    {
        auto g     = editor::assets::defaultGeometry(type);
        auto bytes = editor::assets::makePrimitive(g);
        if (assetRoot.empty())
            assetRoot = projectRoot();
        auto id = uuid(), relative = "assets/" + uuid() + ".glb";
        auto path = resolveAsset(assetRoot, relative);
        std::filesystem::create_directories(path.parent_path());
        {
            std::ofstream f(path, std::ios::binary);
            f.write(reinterpret_cast<const char*>(bytes.data()), std::streamsize(bytes.size()));
            f.close();
            if (!f)
                throw std::runtime_error("Cannot create primitive");
        }
        change([&](auto& draft) {
            draft["schemaVersion"]   = std::max(2, draft["schemaVersion"].template get<int>());
            draft["assets"][id]      = {{"path", relative}, {"sourceSpace", true}, {"name", type}};
            auto transform           = editor::identity();
            transform["position"][1] = editor::assets::groundOffset(g);
            draft["nodes"].push_back(
              {{"id", id}, {"name", type}, {"parentId", nullptr}, {"assetId", id}, {"transform", transform}});
        });
        select(id);
        sidebarTab        = 0;
        lightInspector    = false;
        assetInspectorTab = 1;
        pendingFocus      = id;
        status            = "Created primitive";
    }
    void makeAssetUnique(const std::string& nodeId)
    {
        editor::assertEditable(history.scene, {nodeId});
        change([&](auto& draft) {
            auto source = editor::nodeById(draft, nodeId).at("assetId").template get<std::string>(), id = uuid();
            draft["assets"][id]         = draft["assets"][source];
            draft["assets"][id]["name"] = draft["assets"][id].value("name", std::string("Asset")) + " copy";
            for (auto& node : draft["nodes"])
                if (node["id"] == nodeId)
                    node["assetId"] = id;
        });
        assetInspector.key.clear();
        status = "Independent asset created";
    }
    void prepareAssetInspector()
    {
        for (const auto& n : history.scene["nodes"])
            if (n["id"] == selected && n.contains("assetId"))
            {
                auto id   = n["assetId"].get<std::string>(),
                     path = history.scene["assets"][id]["path"].get<std::string>();
                assetInspector.load(id + path, resolveAsset(assetRoot.empty() ? projectRoot() : assetRoot, path));
                return;
            }
        assetInspector.key.clear();
        assetInspector.doc.reset();
    }
    editor::SceneObjectInspector sceneObjectInspector;
    bool                         mainPreview = false;
    render::OrbitCamera          editorCamera;
    std::string                  sceneViewKey, cameraNotice;
    void                         addSceneObject(const std::string& kind)
    {
        auto id   = uuid();
        auto node = kind == "camera" ? editor::createCamera(id, window ? window->GetCamera() : editorCamera)
                                     : editor::createLight(id);
        change([&](auto& s) {
            s["schemaVersion"] = std::max(3, s["schemaVersion"].template get<int>());
            s["nodes"].push_back(node);
            bool active = false;
            for (const auto& n : s["nodes"])
                if (n.contains(kind) && n[kind][kind == "camera" ? "primary" : "active"] == true)
                    active = true;
            if (!active)
                editor::setPrimary(s, id, kind);
        });
        select(id);
        sidebarTab        = 0;
        assetInspectorTab = 0;
        lightInspector    = false;
    }
    void toggleMainPreview()
    {
        if (mainPreview)
        {
            mainPreview = false;
            if (window)
                window->SetCamera(editorCamera);
            sceneViewKey.clear();
            return;
        }
        auto camera = editor::sceneCamera(history.scene);
        if (!camera)
            throw std::runtime_error("Set a main camera first");
        tools.cancel(history);
        if (window)
            editorCamera = window->GetCamera();
        mainPreview = true;
        cameraNotice.clear();
        sceneViewKey.clear();
    }
    void syncSceneObjects()
    {
        if (!window)
            return;
        if (!mainPreview)
            editorCamera = window->GetCamera();
        auto signature      = history.scene;
        signature["__view"] = {
          mainPreview,
          lit,
          studio.azimuth,
          studio.elevation,
          studio.color,
          studio.intensity,
          studio.shadows,
          studio.softness};
        signature["__assetRoot"] = assetRoot.string();
        auto key                 = signature.dump();
        if (sceneViewKey == key)
            return;
        auto world  = history.scene.value("world", editor::defaultWorld());
        auto map    = world["environment"]["map"];
        auto mapKey = map.is_null() ? std::string() : assetRoot.string() + "/" + map.get<std::string>();
        if (environmentKey != mapKey)
        {
            if (map.is_null())
                window->LoadEnvironment({});
            else
            {
                auto path = resolveAsset(assetRoot.empty() ? projectRoot() : assetRoot, map.get<std::string>());
                editor::validateEnvironmentBytes(editor::assets::readBytes(path));
                window->LoadEnvironment(path);
            }
            environmentKey = mapKey;
        }
        window->SetEnvironment(editor::environmentSettings(world));
        auto color = editor::worldColor(world["background"]["color"]);
        window->SetClearColor({color[0], color[1], color[2], 1});
        auto light = editor::sceneDirectional(history.scene);
        window->SetLighting(lit ? render::LightingMode::PBR : render::LightingMode::Unlit);
        window->SetDirectionalLight(light ? light->light : studio.light());
        window->SetShadows(light ? light->shadows : render::SceneShadowSettings{studio.shadows, studio.softness});
        if (mainPreview)
            try
            {
                auto camera = editor::sceneCamera(history.scene);
                if (camera)
                    window->SetCamera(*camera);
                else
                {
                    mainPreview = false;
                    window->SetCamera(editorCamera);
                }
            }
            catch (const std::exception& e)
            {
                cameraNotice = e.what();
                status       = cameraNotice;
                mainPreview  = false;
                window->SetCamera(editorCamera);
            }
        sceneViewKey = key;
    }
    void drawSceneNodeProperties(const editor::Json& node)
    {
        auto id   = node["id"].get<std::string>(),
             kind = node.contains("camera") ? std::string("camera") : std::string("light");
        sceneObjectInspector.draw(
          node,
          mainPreview,
          cameraNotice,
          [this, id, kind](editor::Json component, double yaw, double pitch) {
              action([this, id, kind, component, yaw, pitch] {
                  change([&](auto& s) {
                      editor::aimObject(s, id, yaw, pitch);
                      for (auto& n : s["nodes"])
                          if (n["id"] == id)
                              n[kind] = component;
                  });
              });
          },
          [this, id, kind](bool enabled) {
              action([this, id, kind, enabled] { change([&](auto& s) { editor::setPrimary(s, id, kind, enabled); }); });
          },
          [this, id] { action([this, id] { change([&](auto& s) { editor::captureCamera(s, id, editorCamera); }); }); },
          [this] { action([this] { toggleMainPreview(); }); });
    }
    editor::Json groupDraft = editor::identity();
    std::string  groupDraftKey;
    void         transformSpaceControl()
    {
        int value = tools.space == editor::TransformSpace::World ? 1 : 0;
        ImGui::TextDisabled("Coordinates");
        ImGui::SetNextItemWidth(-1);
        const char* options[]{"Local", "World"};
        if (ImGui::Combo("##TransformCoordinates", &value, options, 2))
        {
            tools.cancel(history);
            tools.space = value ? editor::TransformSpace::World : editor::TransformSpace::Local;
        }
    }
    void drawGroupTransform()
    {
        transformSpaceControl();
        auto key = history.scene.dump() + editor::Json(selections).dump() + std::to_string(int(tools.space));
        if (groupDraftKey != key)
        {
            groupDraftKey = key;
            groupDraft    = editor::identity();
        }
        std::string error;
        try
        {
            editor::selectionFrame(history.scene, selections, selected, tools.space, assetBounds);
        }
        catch (const std::exception& e)
        {
            error = e.what();
        }
        ImGui::Text("Transform %zu selected nodes", selections.size());
        if (!error.empty())
            ImGui::TextWrapped("%s", error.c_str());
        ImGui::BeginDisabled(!error.empty() || history.previewBase.has_value());
        for (auto field : {"position", "scale"})
        {
            float v[3];
            for (int k = 0; k < 3; k++)
                v[k] = groupDraft[field][k];
            if (editor::theme::vector(std::string(field) == "position" ? "Group translation" : "Group scale", field, v))
                groupDraft[field] = std::vector<float>(v, v + 3);
        }
        auto angles = editor::quaternionEuler(groupDraft["rotation"]);
        if (editor::theme::vector("Group rotation (degrees)", "rotation", angles.data(), "%.1f"))
            groupDraft["rotation"] = editor::eulerQuaternion(angles);
        if (ImGui::Button("Apply group transform", {-1, 29}))
        {
            auto delta = groupDraft, ids = editor::Json(selections);
            auto active = selected;
            auto space  = tools.space;
            action([this, delta, ids, active, space] {
                change([&](auto& s) {
                    auto frame =
                      editor::selectionFrame(s, ids.get<std::vector<std::string>>(), active, space, assetBounds);
                    editor::applySelectionEdits(s, editor::selectionEdits(s, frame, delta));
                });
            });
        }
        ImGui::EndDisabled();
    }
    void drawAssetProperties()
    {
        const auto  id    = selected;
        size_t      users = 0;
        std::string asset;
        for (const auto& n : history.scene["nodes"])
            if (n["id"] == id && n.contains("assetId"))
                asset = n["assetId"].get<std::string>();
        if (asset.empty())
        {
            ImGui::TextDisabled(assetInspectorTab == 2 ? "Submesh material slots" : "Model internal nodes");
            const auto ids = editor::subtreeIds(history.scene, {id});
            for (const auto& n : history.scene["nodes"])
                if (
                  n["id"] != id && ids.count(n["id"].get<std::string>())
                  && (assetInspectorTab != 2 || n.contains("assetId")))
                {
                    ImGui::PushID(n["id"].get<std::string>().c_str());
                    auto label =
                      editor::nodeById(history.scene, n["parentId"].get<std::string>())["name"].get<std::string>()
                      + " / " + n["name"].get<std::string>();
                    if (ImGui::Button(label.c_str(), {-1, 0}))
                    {
                        auto target = n["id"].get<std::string>();
                        action([this, target] { select(target); });
                    }
                    ImGui::PopID();
                }
            return;
        }
        for (const auto& n : history.scene["nodes"])
            if (n.value("assetId", "") == asset)
                users++;
        if (assetInspector.key != asset + history.scene["assets"][asset]["path"].get<std::string>())
            return;
        ImGui::BeginDisabled(editor::inheritedFlag(history.scene, id, "locked"));
        if (
          assetInspector.doc
          && !assetInspector.doc->json.value("extras", editor::Json::object())
                .value("novaEditor", editor::Json::object())
                .value("modelPart", false)
          && ImGui::Button("Expand model hierarchy", {-1, 0}))
            action([this, id] { expandSelectedModel(id); });
        ImGui::EndDisabled();
        assetInspector.draw(
          assetInspectorTab,
          users,
          editor::inheritedFlag(history.scene, id, "locked"),
          [this, id](editor::Json geometry) {
              action([this, id, geometry] {
                  auto doc = selectedAsset(id);
                  writeAssetVersion(id, editor::assets::writeGLB(editor::assets::regenerateGeometry(doc, geometry)));
              });
          },
          [this, id](editor::Json material, std::array<std::string, 5> paths, std::array<bool, 5> remove) {
              action([this, id, material, paths, remove] {
                  auto doc = selectedAsset(id);
                  for (size_t i = 0; i < 5; i++)
                  {
                      if (!paths[i].empty())
                          doc = editor::assets::applyTexture(
                            doc, editor::assets::textureSlots[i], editor::assets::readBytes(paths[i]));
                      else if (remove[i])
                          doc = editor::assets::applyTexture(doc, editor::assets::textureSlots[i], std::nullopt);
                  }
                  doc = editor::assets::applyMaterial(doc, material);
                  writeAssetVersion(id, editor::assets::writeGLB(doc));
              });
          },
          [this, id] { action([this, id] { makeAssetUnique(id); }); });
    }
    void newProject(bool force = false)
    {
        commitNameDraft();
        if (dirty() && !force)
        {
            requestedNew = true;
            showUnsaved  = true;
            return;
        }
        auto destination =
          std::filesystem::absolute(projectPath).parent_path() / ("Untitled-" + uuid().substr(0, 8)) / "project.json";
        clearOwnRecovery();
        if (mainPreview)
            toggleMainPreview();
        cameraNotice.clear();
        history.replace(editor::emptyScene());
        saved = history.scene;
        assetRoot.clear();
        currentProjectPath.clear();
        select("");
        std::snprintf(projectPath, sizeof(projectPath), "%s", destination.string().c_str());
        sidebarTab   = 0;
        requestedNew = false;
        status       = "New project";
    }
    void open(bool force = false)
    {
        if (!force)
            commitNameDraft();
        if (dirty() && !force)
        {
            requestedOpen = projectPath;
            showUnsaved   = true;
            return;
        }
        auto s    = editor::read(projectPath);
        auto root = std::filesystem::absolute(projectPath).parent_path();
        editor::verifyAssets(s, root);
        clearOwnRecovery();
        if (mainPreview)
            toggleMainPreview();
        cameraNotice.clear();
        history.replace(s);
        saved              = s;
        assetRoot          = root;
        currentProjectPath = std::filesystem::absolute(projectPath).string();
        select("");
        status       = "Opened project";
        pendingFocus = "*";
    }
    void autosave(bool force = false)
    {
        if (history.previewBase)
            return;
        if (observed != history.scene)
        {
            observed  = history.scene;
            changedAt = std::chrono::steady_clock::now();
        }
        if (!dirty())
        {
            if (!recoveredSnapshot.is_null() && assetRoot != recoveryFolder)
                clearOwnRecovery();
            return;
        }
        if (recoveredSnapshot == history.scene)
            return;
        if (!force && std::chrono::steady_clock::now() - changedAt < std::chrono::seconds(1))
            return;
        editor::saveRecovery(
          recoveryFolder,
          history.scene,
          saved,
          currentProjectPath.empty() ? std::filesystem::absolute(projectPath)
                                     : std::filesystem::path(currentProjectPath),
          assetRoot.empty() ? projectRoot() : assetRoot);
        recoveredSnapshot = history.scene;
        recoveryStatus    = "Local recovery updated";
    }
    void scanRecovery()
    {
        recoveryFolder = recoveryBase / uuid();
        if (std::filesystem::exists(recoveryBase))
            for (const auto& entry : std::filesystem::directory_iterator(recoveryBase))
            {
                if (entry.is_directory() && std::filesystem::is_regular_file(entry.path() / "project.json"))
                    recoveries.push_back(entry.path());
            }
    }
    void restoreRecovery(const std::filesystem::path& folder)
    {
        if (dirty())
            throw std::runtime_error("Save or discard current changes before restoring");
        auto data = editor::readRecovery(folder);
        editor::saveRecovery(recoveryFolder, data.scene, data.saved, data.originalPath, data.root);
        if (mainPreview)
            toggleMainPreview();
        cameraNotice.clear();
        history.replace(data.scene);
        saved              = data.saved;
        assetRoot          = recoveryFolder;
        currentProjectPath = data.originalPath.string();
        std::snprintf(projectPath, sizeof(projectPath), "%s", currentProjectPath.c_str());
        select("");
        pendingFocus      = "*";
        recoveredSnapshot = data.scene;
        std::filesystem::remove_all(folder);
        recoveries.erase(std::remove(recoveries.begin(), recoveries.end(), folder), recoveries.end());
        status = "Recovered project; save to keep changes";
    }
    void finishRequest(bool saveFirst)
    {
        if (saveFirst)
        {
            auto destination = std::string(projectPath);
            if (!requestedOpen.empty())
                std::snprintf(
                  projectPath,
                  sizeof(projectPath),
                  "%s",
                  currentProjectPath.empty() ? "output/workspace/project.json" : currentProjectPath.c_str());
            try
            {
                save();
            }
            catch (...)
            {
                std::snprintf(projectPath, sizeof(projectPath), "%s", destination.c_str());
                throw;
            }
            std::snprintf(projectPath, sizeof(projectPath), "%s", destination.c_str());
        }
        if (!requestedOpen.empty())
        {
            // Validate the destination before allowing a discard to remove recovery.
            auto target = editor::read(requestedOpen);
            editor::verifyAssets(target, std::filesystem::absolute(requestedOpen).parent_path());
            std::snprintf(projectPath, sizeof(projectPath), "%s", requestedOpen.c_str());
            open(true);
            requestedOpen.clear();
        }
        else if (requestedNew)
        {
            newProject(true);
        }
        else if (requestClose)
        {
            clearOwnRecovery();
            exitApproved = true;
        }
        showUnsaved = false;
    }
    void treeCommand(const std::string& cmd, std::vector<std::string> ids = {})
    {
        if (ids.empty())
            ids = selections;
        auto nextSelection = ids;
        change([&](auto& s) {
            if (cmd == "group")
                nextSelection = {editor::groupNodes(s, ids, uuid())};
            else if (cmd == "ungroup")
                nextSelection = editor::ungroupNodes(s, ids);
            else if (cmd == "duplicate")
                nextSelection = editor::duplicateNodes(s, ids, uuid);
            else if (cmd == "delete")
            {
                editor::deleteNodes(s, ids);
                nextSelection.clear();
            }
            else if (cmd == "up" || cmd == "down")
            {
                if (ids.size() != 1)
                    throw std::runtime_error("Select one node for arrow sorting; drag for batch sorting");
                auto                     n = editor::nodeById(s, ids[0]);
                std::vector<std::string> siblings;
                for (const auto& c : s["nodes"])
                    if (c["parentId"] == n["parentId"])
                        siblings.push_back(c["id"].template get<std::string>());
                auto i = std::find(siblings.begin(), siblings.end(), ids[0]) - siblings.begin();
                if (cmd == "up" && i > 0)
                    editor::reparentNodes(s, ids, n["parentId"], siblings[i - 1]);
                if (cmd == "down" && i + 1 < siblings.size())
                    editor::reparentNodes(s, ids, n["parentId"], i + 2 < siblings.size() ? siblings[i + 2] : "");
            }
            else
                editor::setNodeFlag(
                  s, ids, cmd == "hide" || cmd == "show" ? "hidden" : "locked", cmd == "hide" || cmd == "lock");
        });
        selectMany(nextSelection);
        status = "Scene tree updated";
    }
    void writeModelFiles(const std::map<std::string, editor::assets::Bytes>& files)
    {
        if (assetRoot.empty())
            assetRoot = projectRoot();
        for (const auto& [relative, bytes] : files)
        {
            auto path = resolveAsset(assetRoot, relative);
            std::filesystem::create_directories(path.parent_path());
            std::ofstream f(path, std::ios::binary);
            f.write(reinterpret_cast<const char*>(bytes.data()), std::streamsize(bytes.size()));
            f.close();
            if (!f)
                throw std::runtime_error("Cannot write model part");
        }
    }
    void expandSelectedModel(const std::string& id)
    {
        auto doc   = selectedAsset(id);
        auto model = editor::assets::decodeModel(editor::assets::writeGLB(doc));
        auto draft = history.scene;
        auto files = editor::assets::expandModel(draft, id, model, uuid);
        writeModelFiles(files);
        change([&](auto& s) { s = draft; });
        assetInspector.key.clear();
        status = "Model expanded; undo available";
    }
    void importModel()
    {
        auto src = std::filesystem::absolute(modelPath);
        if (src.extension() != ".glb")
            throw std::runtime_error("Choose a .glb file");
        if (assetRoot.empty())
            assetRoot = projectRoot();
        auto model = editor::assets::decodeModel(editor::assets::readBytes(src));
        auto id    = uuid();
        auto draft = history.scene;
        draft["nodes"].push_back(
          {{"id", id}, {"parentId", nullptr}, {"name", src.stem().string()}, {"transform", editor::identity()}});
        auto files = editor::assets::expandModel(draft, id, model, uuid);
        writeModelFiles(files);
        change([&](auto& s) { s = draft; });
        select(id);
        pendingFocus = id;
        preview      = src.stem().string();
        sidebarTab   = 0;
        status       = "Model imported";
    }
    bool searchMatch(const editor::Json& node)
    {
        auto label = node["name"].get<std::string>(), query = std::string(search);
        auto lower = [](std::string v) {
            std::transform(v.begin(), v.end(), v.begin(), [](unsigned char c) { return char(std::tolower(c)); });
            return v;
        };
        if (lower(label).find(lower(query)) != std::string::npos)
            return true;
        for (const auto& n : history.scene["nodes"])
            if (n["parentId"] == node["id"] && searchMatch(n))
                return true;
        return false;
    }
    std::vector<std::string> visibleNodes;
    void                     tree(const editor::Json& parent)
    {
        for (const auto& n : history.scene["nodes"])
        {
            if (n["parentId"] != parent || !searchMatch(n))
                continue;
            auto id = n["id"].get<std::string>();
            visibleNodes.push_back(id);
            ImGui::PushID(id.c_str());
            bool children = false;
            for (const auto& c : history.scene["nodes"])
                if (c["parentId"] == id)
                    children = true;
            auto flags = ImGuiTreeNodeFlags_OpenOnArrow | ImGuiTreeNodeFlags_SpanAvailWidth
                         | ImGuiTreeNodeFlags_DefaultOpen | ImGuiTreeNodeFlags_FramePadding;
            if (!children)
                flags |= ImGuiTreeNodeFlags_Leaf;
            if (std::find(selections.begin(), selections.end(), id) != selections.end())
                flags |= ImGuiTreeNodeFlags_Selected;
            if (search[0])
                ImGui::SetNextItemOpen(true);
            bool hidden = editor::inheritedFlag(history.scene, id, "hidden"),
                 locked = editor::inheritedFlag(history.scene, id, "locked");
            std::string label =
              (hidden ? "[H] " : "") + (locked ? std::string("[L] ") : std::string()) + n["name"].get<std::string>();
            if (n.contains("camera"))
                label = "[Camera] " + label + (n["camera"]["primary"] == true ? " *" : "");
            if (n.contains("light"))
                label = "[Light] " + label + (n["light"]["active"] == true ? " *" : "");
            bool expanded = ImGui::TreeNodeEx("node", flags, "%s", label.c_str());
            if (ImGui::IsItemClicked() && !ImGui::IsItemToggledOpen())
            {
                auto& io       = ImGui::GetIO();
                auto  previous = selections;
                if (io.KeyCtrl || io.KeySuper)
                {
                    auto it = std::find(previous.begin(), previous.end(), id);
                    if (it == previous.end())
                        previous.push_back(id);
                    else
                        previous.erase(it);
                    selectMany(previous);
                }
                else if (io.KeyShift && !anchor.empty())
                {
                    auto all = previousVisible;
                    auto a = std::find(all.begin(), all.end(), anchor), b = std::find(all.begin(), all.end(), id);
                    if (a != all.end() && b != all.end())
                    {
                        if (a > b)
                            std::swap(a, b);
                        selectMany(std::vector<std::string>(a, b + 1));
                    }
                    else
                        select(id);
                }
                else
                    select(id);
                anchor = id;
            }
            if (!locked && ImGui::BeginDragDropSource())
            {
                if (std::find(selections.begin(), selections.end(), id) == selections.end())
                    select(id);
                auto payload = editor::Json(selections).dump();
                ImGui::SetDragDropPayload("NOVA_NODES", payload.c_str(), payload.size() + 1);
                ImGui::Text("Move %zu nodes", selections.size());
                ImGui::EndDragDropSource();
            }
            if (ImGui::BeginDragDropTarget())
            {
                if (const auto* payload = ImGui::AcceptDragDropPayload("NOVA_NODES"))
                {
                    auto ids =
                      editor::Json::parse(static_cast<const char*>(payload->Data)).get<std::vector<std::string>>();
                    auto        min = ImGui::GetItemRectMin(), max = ImGui::GetItemRectMax();
                    auto        y      = (ImGui::GetMousePos().y - min.y) / (max.y - min.y);
                    auto        target = n["parentId"];
                    std::string before;
                    if (y >= .25f && y <= .75f)
                        target = id;
                    else if (y < .25f)
                        before = id;
                    else
                    {
                        bool found = false;
                        for (const auto& c : history.scene["nodes"])
                            if (c["parentId"] == target)
                            {
                                if (found)
                                {
                                    before = c["id"].get<std::string>();
                                    break;
                                }
                                if (c["id"] == id)
                                    found = true;
                            }
                    }
                    action([this, ids, target, before] {
                        change([&](auto& s) { editor::reparentNodes(s, ids, target, before); });
                        status = "Moved nodes; world transforms preserved";
                    });
                }
                ImGui::EndDragDropTarget();
            }
            if (ImGui::BeginPopupContextItem("NodeActions"))
            {
                if (std::find(selections.begin(), selections.end(), id) == selections.end())
                    select(id);
                for (auto command :
                     {"group", "ungroup", "duplicate", "delete", "hide", "show", "lock", "unlock", "up", "down"})
                    if (ImGui::MenuItem(command))
                        action([this, cmd = std::string(command)] { treeCommand(cmd); });
                if (ImGui::MenuItem("Rename"))
                {
                    select(id);
                    sidebarTab      = 0;
                    lightInspector  = false;
                    renameRequested = true;
                }
                ImGui::TextDisabled("Rename: Enter to confirm");
                ImGui::EndPopup();
            }
            if (expanded)
            {
                tree(id);
                ImGui::TreePop();
            }
            ImGui::PopID();
        }
    }
    std::vector<std::string> previousVisible;
    void                     drawDialogs()
    {
        if (showUnsaved)
            ImGui::OpenPopup("Unsaved changes");
        if (ImGui::BeginPopupModal("Unsaved changes", nullptr, ImGuiWindowFlags_AlwaysAutoResize))
        {
            ImGui::TextWrapped(
              "Save changes before %s?",
              requestedNew            ? "creating a new project"
              : requestedOpen.empty() ? "closing"
                                      : "opening another project");
            if (ImGui::Button("Save and continue"))
            {
                action([this] { finishRequest(true); });
            }
            ImGui::SameLine();
            if (ImGui::Button("Discard and continue"))
            {
                action([this] { finishRequest(false); });
            }
            ImGui::SameLine();
            if (ImGui::Button("Cancel"))
            {
                requestClose = false;
                requestedNew = false;
                requestedOpen.clear();
                showUnsaved = false;
                ImGui::CloseCurrentPopup();
            }
            ImGui::TextWrapped("%s", status.c_str());
            if (!showUnsaved)
                ImGui::CloseCurrentPopup();
            ImGui::EndPopup();
        }
        if (!recoveries.empty() && !recoveryDismissed)
        {
            ImGui::SetNextWindowPos({260, 100}, ImGuiCond_Appearing);
            ImGui::SetNextWindowSize({550, 0}, ImGuiCond_Appearing);
            if (ImGui::Begin("Local recovery"))
            {
                ImGui::TextDisabled("Recover unsaved project");
                ImGui::SameLine();
                if (ImGui::SmallButton("Later"))
                    recoveryDismissed = true;
                for (const auto& folder : recoveries)
                {
                    auto key = folder.string();
                    ImGui::PushID(key.c_str());
                    ImGui::Text("%s", folder.filename().string().c_str());
                    if (ImGui::Button("Restore"))
                        action([this, folder] { restoreRecovery(folder); });
                    ImGui::SameLine();
                    if (ImGui::Button("Discard this copy"))
                        action([this, folder] {
                            std::filesystem::remove_all(folder);
                            recoveries.erase(
                              std::remove(recoveries.begin(), recoveries.end(), folder), recoveries.end());
                        });
                    ImGui::PopID();
                }
            }
            ImGui::End();
        }
    }
    void panel(const char* title, ImVec2 pos, ImVec2 size, bool titleVisible = true)
    {
        ImGui::SetNextWindowPos(pos);
        ImGui::SetNextWindowSize(size);
        auto background = ImGui::GetStyle().Colors[ImGuiCol_WindowBg];
        ImGui::PushStyleColor(ImGuiCol_WindowBg, background);
        ImGui::Begin(
          title,
          nullptr,
          ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoResize
            | ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoSavedSettings);
        ImGui::PopStyleColor();
        if (titleVisible)
        {
            editor::theme::heading(title);
            ImGui::Separator();
            ImGui::Spacing();
        }
    }
    void queueLighting()
    {
        auto config  = studio;
        auto enabled = lit;
        action([this, config, enabled] {
            window->SetLighting(enabled ? render::LightingMode::PBR : render::LightingMode::Unlit);
            auto world  = history.scene.value("world", editor::defaultWorld());
            auto map    = world["environment"]["map"];
            auto mapKey = map.is_null() ? std::string() : assetRoot.string() + "/" + map.get<std::string>();
            if (environmentKey != mapKey)
            {
                if (map.is_null())
                    window->LoadEnvironment({});
                else
                {
                    auto path = resolveAsset(assetRoot.empty() ? projectRoot() : assetRoot, map.get<std::string>());
                    editor::validateEnvironmentBytes(editor::assets::readBytes(path));
                    window->LoadEnvironment(path);
                }
                environmentKey = mapKey;
            }
            window->SetEnvironment(editor::environmentSettings(world));
            auto color = editor::worldColor(world["background"]["color"]);
            window->SetClearColor({color[0], color[1], color[2], 1});
            auto light = editor::sceneDirectional(history.scene);
            window->SetDirectionalLight(light ? light->light : config.light());
            window->SetShadows(light ? light->shadows : render::SceneShadowSettings{config.shadows, config.softness});
        });
    }
    void drawLightSettings()
    {
        if (auto light = editor::sceneDirectional(history.scene))
        {
            editor::theme::heading("Scene lighting");
            ImGui::TextWrapped("Edit the active directional light node.");
            if (ImGui::Button("Select scene light", {-1, 29}))
            {
                auto id = light->id;
                action([this, id] {
                    select(id);
                    assetInspectorTab = 0;
                    lightInspector    = false;
                });
            }
            return;
        }
        editor::theme::heading("Viewport lighting");
        ImGui::TextDisabled("Directional light + studio fill");
        ImGui::Spacing();
        bool changed = ImGui::Checkbox("Enable lighting", &lit);
        ImGui::BeginDisabled(!lit);
        ImGui::TextDisabled("Azimuth (degrees)");
        ImGui::SetNextItemWidth(-1);
        changed |=
          ImGui::SliderFloat("##LightAzimuth", &studio.azimuth, -180, 180, "%.1f", ImGuiSliderFlags_AlwaysClamp);
        ImGui::TextDisabled("Elevation (degrees)");
        ImGui::SetNextItemWidth(-1);
        changed |=
          ImGui::SliderFloat("##LightElevation", &studio.elevation, 5, 85, "%.1f", ImGuiSliderFlags_AlwaysClamp);
        ImGui::TextDisabled("Light color");
        ImGui::SetNextItemWidth(-1);
        changed |= ImGui::ColorEdit3("##LightColor", studio.color.data(), ImGuiColorEditFlags_DisplayHex);
        ImGui::TextDisabled("Intensity");
        ImGui::SetNextItemWidth(-1);
        changed |=
          ImGui::SliderFloat("##LightIntensity", &studio.intensity, 0, 10, "%.2f", ImGuiSliderFlags_AlwaysClamp);
        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        changed |= ImGui::Checkbox("Cast shadows", &studio.shadows);
        ImGui::BeginDisabled(!studio.shadows);
        ImGui::TextDisabled("Shadow softness");
        ImGui::SetNextItemWidth(-1);
        changed |= ImGui::SliderFloat("##ShadowSoftness", &studio.softness, 0, 4, "%.1f", ImGuiSliderFlags_AlwaysClamp);
        ImGui::TextDisabled("0: hard                      4: soft");
        ImGui::EndDisabled();
        ImGui::EndDisabled();
        ImGui::Spacing();
        if (ImGui::Button("Reset lighting", {-1, 29}))
        {
            studio  = {};
            lit     = true;
            changed = true;
        }
        ImGui::TextWrapped("Viewport only");
        if (changed)
            queueLighting();
    }
    void drawProjectSettings()
    {
        if (sidebarTab == 1)
        {
            editor::theme::heading("Project");
            ImGui::TextWrapped("%s", history.scene["name"].get<std::string>().c_str());
            ImGui::TextDisabled(
              "%zu nodes / %zu assets", history.scene["nodes"].size(), history.scene["assets"].size());
            ImGui::Spacing();
            ImGui::TextDisabled("Project path");
            ImGui::SetNextItemWidth(-1);
            if (focusProjectPath)
            {
                ImGui::SetKeyboardFocusHere();
                focusProjectPath = false;
            }
            ImGui::InputText("##ProjectPath", projectPath, sizeof(projectPath));
            if (ImGui::Button("Open"))
                action([this] { open(); });
            ImGui::SameLine();
            if (ImGui::Button("Save"))
                action([this] { save(); });
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            editor::theme::heading("Resources");
            ImGui::TextDisabled("GLB path");
            ImGui::SetNextItemWidth(-1);
            if (focusModelPath)
            {
                ImGui::SetKeyboardFocusHere();
                focusModelPath = false;
            }
            ImGui::InputText("##ModelPath", modelPath, sizeof(modelPath));
            if (ImGui::Button("Import GLB"))
                action([this] { importModel(); });
            if (ImGui::Button(assetsOpen ? "Hide assets" : "Show assets"))
                assetsOpen = !assetsOpen;
            ImGui::Spacing();
            ImGui::TextWrapped("%s", recoveryStatus.c_str());
            if (!recoveries.empty() && ImGui::Button("Recovery copies..."))
                recoveryDismissed = false;
        }
        else
        {
            editor::theme::heading("View");
            ImGui::Checkbox("Asset drawer", &assetsOpen);
            ImGui::Checkbox("Grid snap", &tools.gridSnap);
            // Existing controls remain in the viewport too.
            bool lighting = lit;
            if (ImGui::Checkbox("Studio lighting", &lighting))
            {
                lit = lighting;
                queueLighting();
            }
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            editor::theme::heading("Shortcuts");
            ImGui::TextDisabled("W / E / R   Move / Rotate / Scale");
            ImGui::TextDisabled("X   Local / World coordinates");
            ImGui::TextDisabled("H / P       Pan / Projection");
            ImGui::TextDisabled("F / Shift F Focus / Frame all");
            ImGui::TextDisabled("Ctrl/Cmd S  Save");
            ImGui::TextDisabled("Ctrl/Cmd Z  Undo");
            ImGui::TextDisabled("Shift Z     Redo (Ctrl/Cmd)");
        }
    }
    void draw()
    {
        nativeHandle      = static_cast<GLFWwindow*>(ImGui::GetMainViewport()->PlatformHandle);
        auto        d     = ImGui::GetIO().DisplaySize;
        const float right = std::min(330.f, std::max(260.f, d.x * .26f)), left = 0, top = ImGui::GetFrameHeight();
        const float center = std::max(1.f, d.x - right), bottom = (assetsOpen ? 145.f : 30.f) + 25.f;
        const float sideTop = top + 35, sideHeight = std::max(1.f, d.y - sideTop - 25);
        scenePanelHeight = std::clamp(scenePanelHeight, 140.f, std::max(140.f, sideHeight * .55f));
        if (ImGui::BeginMainMenuBar())
        {
            ImGui::TextDisabled("NOVA");
            if (ImGui::BeginMenu("File"))
            {
                if (ImGui::MenuItem("New project"))
                    action([this] { newProject(); });
                if (ImGui::MenuItem("Open project..."))
                {
                    sidebarTab       = 1;
                    focusProjectPath = true;
                }
                if (ImGui::MenuItem("Save", "Ctrl/Cmd S"))
                    action([this] { save(); });
                if (ImGui::MenuItem("Save as..."))
                {
                    sidebarTab       = 1;
                    focusProjectPath = true;
                }
                if (ImGui::MenuItem("Import GLB..."))
                {
                    sidebarTab     = 1;
                    focusModelPath = true;
                }
                ImGui::EndMenu();
            }
            if (ImGui::BeginMenu("Edit"))
            {
                if (ImGui::MenuItem("Undo", "Ctrl/Cmd Z", false, !history.past.empty()))
                    action([this] {
                        history.undo();
                        select("");
                    });
                if (ImGui::MenuItem("Redo", "Ctrl/Cmd Shift Z", false, !history.future.empty()))
                    action([this] {
                        history.redo();
                        select("");
                    });
                ImGui::Separator();
                for (auto cmd : {"duplicate", "delete", "group", "ungroup"})
                    if (ImGui::MenuItem(cmd, nullptr, false, !selections.empty()))
                        action([this, command = std::string(cmd)] { treeCommand(command); });
                ImGui::EndMenu();
            }
            if (ImGui::BeginMenu("Add"))
            {
                if (ImGui::MenuItem("Directional light"))
                    action([this] { addSceneObject("light"); });
                if (ImGui::MenuItem("Camera"))
                    action([this] { addSceneObject("camera"); });

                if (ImGui::BeginMenu("Mesh"))
                {
                    for (const auto& item : editor::assets::primitives())
                        if (ImGui::MenuItem(item.first.c_str()))
                            action([this, type = item.first] { createPrimitive(type); });
                    ImGui::EndMenu();
                }
                if (ImGui::MenuItem("Empty node"))
                    action([this] {
                        add();
                        sidebarTab = 0;
                    });
                if (ImGui::MenuItem("Model..."))
                {
                    sidebarTab     = 1;
                    focusModelPath = true;
                }
                ImGui::EndMenu();
            }
            if (ImGui::BeginMenu("View"))
            {
                if (ImGui::MenuItem(
                      mainPreview ? "Return to editor view" : "Preview main camera",
                      nullptr,
                      false,
                      mainPreview || !editor::primaryCamera(history.scene).empty()))
                    action([this] { toggleMainPreview(); });

                if (ImGui::MenuItem("World coordinates", "X", tools.space == editor::TransformSpace::World))
                {
                    tools.cancel(history);
                    tools.space = tools.space == editor::TransformSpace::World ? editor::TransformSpace::Local
                                                                               : editor::TransformSpace::World;
                }
                if (ImGui::MenuItem("Focus selected", "F", false, !tools.drag && !mainPreview))
                    action([this] { frame(selected); });
                if (ImGui::MenuItem("Frame all", "Shift F", false, !tools.drag && !mainPreview))
                    action([this] { frame(""); });
                if (ImGui::MenuItem("Orthographic", "P", window->GetCamera().orthographic, !tools.drag && !mainPreview))
                    action([this] {
                        auto c         = window->GetCamera();
                        c.orthographic = !c.orthographic;
                        window->SetCamera(c);
                    });
                if (ImGui::MenuItem("Assets", nullptr, assetsOpen))
                    assetsOpen = !assetsOpen;
                if (ImGui::MenuItem("Light settings"))
                {
                    sidebarTab     = 0;
                    lightInspector = true;
                }
                if (ImGui::MenuItem("Reset view", nullptr, false, !tools.drag && !mainPreview))
                    action([this] {
                        auto c         = window->GetCamera();
                        c.distance     = 8;
                        c.yaw          = 25;
                        c.pitch        = 20;
                        c.target       = {0, 0, 0};
                        c.orthographic = false;
                        window->SetCamera(c);
                    });
                ImGui::EndMenu();
            }
            ImGui::SameLine(std::max(370.f, d.x - 300));
            ImGui::TextDisabled("%s%s", history.scene["name"].get<std::string>().c_str(), dirty() ? " *" : "");
            ImGui::EndMainMenuBar();
        }
        panel("##SidebarTabs", {center, top}, {right, 35}, false);
        if (editor::theme::tool("Scene", sidebarTab == 0))
            sidebarTab = 0;
        ImGui::SameLine();
        if (editor::theme::tool("Project", sidebarTab == 1))
            sidebarTab = 1;
        ImGui::SameLine();
        if (editor::theme::tool("Settings", sidebarTab == 2))
            sidebarTab = 2;
        ImGui::End();
        if (sidebarTab == 0)
        {
            panel("Scene", {center, sideTop}, {right, scenePanelHeight});
            if (ImGui::Button("+ New node"))
                action([this] { add(); });
            ImGui::SameLine();
            if (ImGui::Button("Clear"))
                select("");
            ImGui::SetNextItemWidth(-1);
            ImGui::InputTextWithHint("##Search", "Search nodes", search, sizeof(search));
            ImGui::Button("Scene root", {-1, 28});
            if (ImGui::IsItemHovered())
                ImGui::SetTooltip(
                  "Drop here to move to root. Row center: parent; edges: sort. Ctrl/Cmd: multi-select; Shift: range.");
            if (ImGui::BeginDragDropTarget())
            {
                if (const auto* p = ImGui::AcceptDragDropPayload("NOVA_NODES"))
                {
                    auto ids = editor::Json::parse(static_cast<const char*>(p->Data)).get<std::vector<std::string>>();
                    action([this, ids] { change([&](auto& s) { editor::reparentNodes(s, ids, nullptr); }); });
                }
                ImGui::EndDragDropTarget();
            }
            ImGui::Separator();
            visibleNodes.clear();
            tree(nullptr);
            previousVisible = visibleNodes;
            ImGui::TextDisabled("%zu selected", selections.size());
            if (ImGui::IsItemHovered())
                ImGui::SetTooltip(
                  "Multi-selection transforms together. Local axes follow the active node. Right-click for hide, "
                  "lock "
                  "and sort.");
            ImGui::End();
            ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {0, 0});
            panel("##SceneSplit", {center, sideTop + scenePanelHeight}, {right, 6}, false);
            ImGui::InvisibleButton("Resize scene tree", {right, 6});
            if (ImGui::IsItemHovered() || ImGui::IsItemActive())
                ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeNS);
            if (ImGui::IsItemActive())
                scenePanelHeight += ImGui::GetIO().MouseDelta.y;
            ImGui::End();
            ImGui::PopStyleVar();
            panel(
              "Inspector",
              {center, sideTop + scenePanelHeight + 6},
              {right, std::max(1.f, sideHeight - scenePanelHeight - 6)},
              false);
            bool hasSelectedAsset = false;
            for (const auto& node : history.scene["nodes"])
                if (node["id"] == selected && !node.contains("camera") && !node.contains("light"))
                    hasSelectedAsset = true;
            if (!hasSelectedAsset && assetInspectorTab != 3)
                assetInspectorTab = 0;
            if (editor::theme::tool("Object", !lightInspector && assetInspectorTab == 0))
            {
                lightInspector    = false;
                assetInspectorTab = 0;
            }
            if (hasSelectedAsset)
            {
                ImGui::SameLine();
                if (editor::theme::tool("Geometry", !lightInspector && assetInspectorTab == 1))
                {
                    lightInspector    = false;
                    assetInspectorTab = 1;
                }
                if (ImGui::GetContentRegionAvail().x > 85)
                    ImGui::SameLine();
                if (editor::theme::tool("Material", !lightInspector && assetInspectorTab == 2))
                {
                    lightInspector    = false;
                    assetInspectorTab = 2;
                }
            }
            if (ImGui::GetContentRegionAvail().x > 70)
                ImGui::SameLine();
            if (editor::theme::tool("Light", lightInspector))
            {
                lightInspector    = true;
                assetInspectorTab = 0;
            }
            if (ImGui::GetContentRegionAvail().x > 75)
                ImGui::SameLine();
            if (editor::theme::tool("World", !lightInspector && assetInspectorTab == 3))
            {
                lightInspector    = false;
                assetInspectorTab = 3;
            }
            ImGui::Separator();
            if (!lightInspector && assetInspectorTab == 3)
                worldInspector.draw(
                  history.scene,
                  helperRoot.parent_path() / "environments",
                  [this](editor::Json world) {
                      action([this, world] {
                          editor::validateWorld(world);
                          change([&](auto& s) {
                              s["schemaVersion"] = 4;
                              s["world"]         = world;
                          });
                      });
                  },
                  [this](std::filesystem::path path) {
                      action([this, path] {
                          auto bytes = editor::assets::readBytes(path);
                          editor::validateEnvironmentBytes(bytes);
                          if (assetRoot.empty())
                              assetRoot = projectRoot();
                          auto relative = "assets/" + uuid() + ".nenv";
                          auto dest     = resolveAsset(assetRoot, relative);
                          std::filesystem::create_directories(dest.parent_path());
                          std::ofstream file(dest, std::ios::binary);
                          file.write(reinterpret_cast<const char*>(bytes.data()), bytes.size());
                          file.close();
                          if (!file)
                              throw std::runtime_error("Cannot write environment");
                          change([&](auto& s) {
                              auto world                   = s.value("world", editor::defaultWorld());
                              world["environment"]["map"]  = relative;
                              world["environment"]["name"] = path.filename().string();
                              world["background"]["mode"]  = "environment";
                              s["schemaVersion"]           = 4;
                              s["world"]                   = world;
                          });
                      });
                  });
            else if (lightInspector)
                drawLightSettings();
            else if (assetInspectorTab)
                drawAssetProperties();
            else if (selections.size() > 1)
                drawGroupTransform();
            else
            {
                bool found = false;
                for (const auto& n : history.scene["nodes"])
                {
                    if (n["id"] != selected)
                        continue;
                    found             = true;
                    const bool locked = editor::inheritedFlag(history.scene, selected, "locked");
                    if (locked)
                        ImGui::TextWrapped("Locked");
                    transformSpaceControl();
                    ImGui::BeginDisabled(locked);
                    if (n.contains("camera") || n.contains("light"))
                        drawSceneNodeProperties(n);
                    editor::theme::heading(n.contains("assetId") ? "Model instance" : "Node");
                    ImGui::Spacing();
                    ImGui::TextDisabled("Name");
                    ImGui::SetNextItemWidth(-1);
                    if (renameRequested)
                    {
                        ImGui::SetKeyboardFocusHere();
                        renameRequested = false;
                    }
                    const bool renameEnter =
                      ImGui::InputText("##Name", name, sizeof(name), ImGuiInputTextFlags_EnterReturnsTrue);
                    if (ImGui::IsItemEdited())
                        nameDraftDirty = true;
                    if (renameEnter || ImGui::IsItemDeactivatedAfterEdit())
                    {
                        std::string value = name, id = selected;
                        action([this, value, id] {
                            nameDraftDirty = false;
                            change([&](auto& s) {
                                for (auto& node : s["nodes"])
                                    if (node["id"] == id)
                                        node["name"] = value;
                            });
                        });
                    }
                    ImGui::Spacing();
                    ImGui::Separator();
                    ImGui::Spacing();
                    if (n.contains("assetId"))
                    {
                        auto id = n["assetId"].get<std::string>();
                        auto b  = assetBounds.find(id);
                        if (b != assetBounds.end())
                        {
                            ImGui::TextDisabled(
                              "%s",
                              history.scene["assets"][id].value("sourceSpace", false) ? "Source dimensions (m)"
                                                                                      : "Legacy normalized dimensions");
                            ImGui::TextDisabled(
                              "%.3f x %.3f x %.3f",
                              b->second.maximum[0] - b->second.minimum[0],
                              b->second.maximum[1] - b->second.minimum[1],
                              b->second.maximum[2] - b->second.minimum[2]);
                            ImGui::Spacing();
                        }
                    }
                    editor::theme::heading("Transform");
                    ImGui::Spacing();
                    try
                    {
                        const auto inspected = editor::readNodeTransform(history.scene, selected, tools.space);
                        for (const auto* key : {"position", "scale"})
                        {
                            float v[3];
                            for (int i = 0; i < 3; i++)
                                v[i] = inspected[key][i];
                            if (editor::theme::vector(std::string(key) == "position" ? "Position" : "Scale", key, v))
                            {
                                auto               id = selected;
                                std::vector<float> values(v, v + 3);
                                std::string        k     = key;
                                auto               space = tools.space;
                                action([this, id, k, values, space] {
                                    change([&](auto& s) {
                                        auto t = editor::readNodeTransform(s, id, space);
                                        t[k]   = values;
                                        editor::writeNodeTransform(s, id, space, t);
                                    });
                                });
                            }
                        }
                        auto angles = editor::quaternionEuler(inspected["rotation"]);
                        if (editor::theme::vector("Rotation (degrees)", "rotation", angles.data(), "%.1f"))
                        {
                            auto id       = selected;
                            auto rotation = editor::eulerQuaternion(angles);
                            auto space    = tools.space;
                            action([this, id, rotation, space] {
                                change([&](auto& s) {
                                    auto t        = editor::readNodeTransform(s, id, space);
                                    t["rotation"] = rotation;
                                    editor::writeNodeTransform(s, id, space, t);
                                });
                            });
                        }
                    }
                    catch (const std::exception&)
                    {
                        ImGui::TextWrapped("World transform contains shear. Use Local numeric fields.");
                    }
                    if (ImGui::Button("Drop to surface", {-1, 29}))
                        action([this] { landSelected(); });
                    if (ImGui::Button("Duplicate selection", {-1, 29}))
                        action([this] { treeCommand("duplicate"); });
                    if (ImGui::Button("Delete selection", {-1, 29}))
                        action([this] { treeCommand("delete"); });
                    ImGui::EndDisabled();
                    break;
                }
                if (!found)
                    ImGui::TextWrapped("Select an object.");
            }
            ImGui::End();
        }
        else
        {
            panel("##SidebarPage", {center, sideTop}, {right, sideHeight}, false);
            drawProjectSettings();
            ImGui::End();
        }
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {8, 3});
        panel("##AssetDrawer", {0, d.y - bottom}, {center, 30}, false);
        if (ImGui::Button(assetsOpen ? "- Assets" : "+ Assets"))
            assetsOpen = !assetsOpen;
        ImGui::SameLine();
        ImGui::TextDisabled("%zu", history.scene["assets"].size());
        ImGui::SameLine();
        if (ImGui::SmallButton("Import GLB..."))
        {
            sidebarTab     = 1;
            focusModelPath = true;
        }
        ImGui::End();
        ImGui::PopStyleVar();
        if (assetsOpen)
        {
            panel("##AssetContent", {0, d.y - bottom + 30}, {center, bottom - 55}, false);
            {
                ImGui::BeginChild("##AssetFiles", {0, 66}, ImGuiChildFlags_None, ImGuiWindowFlags_HorizontalScrollbar);
                size_t index = 0;
                for (auto it = history.scene["assets"].begin(); it != history.scene["assets"].end(); ++it)
                {
                    if (index++)
                        ImGui::SameLine();
                    const auto  id    = it.key();
                    std::string label = std::filesystem::path(it.value()["path"].get<std::string>()).stem().string(),
                                nodeId;
                    bool active = false;
                    for (const auto& n : history.scene["nodes"])
                        if (n.value("assetId", "") == id)
                        {
                            if (nodeId.empty())
                            {
                                nodeId = n["id"].get<std::string>();
                                label  = n["name"].get<std::string>();
                            }
                            if (n["id"] == selected)
                                active = true;
                        }
                    if (it.value().contains("name"))
                        label = it.value()["name"].get<std::string>();
                    ImGui::PushID(id.c_str());
                    auto  p       = ImGui::GetCursorScreenPos();
                    auto* painter = ImGui::GetWindowDrawList();
                    painter->AddRectFilled(p, {p.x + 178, p.y + 54}, ImGui::GetColorU32(ImGuiCol_FrameBg), 5);
                    painter->AddRect(p, {p.x + 178, p.y + 54}, ImGui::GetColorU32(ImGuiCol_Border), 5);
                    if (ImGui::Selectable("##Asset", active, ImGuiSelectableFlags_None, {178, 54}) && !nodeId.empty())
                        action([this, nodeId] { select(nodeId); });
                    if (ImGui::BeginDragDropSource())
                    {
                        const auto* previous = ImGui::GetDragDropPayload();
                        if (!previous || !previous->IsDataType("NOVA_ASSET"))
                            tools.placementCancelled = false;
                        ImGui::SetDragDropPayload("NOVA_ASSET", id.c_str(), id.size() + 1);
                        ImGui::TextUnformatted(label.c_str());
                        ImGui::TextDisabled("Drag into viewport | Esc cancels");
                        ImGui::EndDragDropSource();
                    }
                    editor::theme::cube(painter, {p.x + 23, p.y + 26}, ImGui::GetColorU32(ImGuiCol_CheckMark));
                    painter->PushClipRect({p.x + 43, p.y}, {p.x + 174, p.y + 54}, true);
                    painter->AddText({p.x + 43, p.y + 10}, ImGui::GetColorU32(ImGuiCol_Text), label.c_str());
                    painter->AddText({p.x + 43, p.y + 31}, ImGui::GetColorU32(ImGuiCol_TextDisabled), "GLB model");
                    painter->PopClipRect();
                    ImGui::PopID();
                }
                if (!index)
                    ImGui::TextDisabled("Import a model to start your asset library.");
                ImGui::EndChild();
            }
            ImGui::End();
        }
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {12, 4});
        panel("##Status", {0, d.y - 25}, {d.x, 25}, false);
        ImGui::TextDisabled("%s | %s", status.c_str(), recoveryStatus.c_str());
        if (ImGui::IsItemHovered())
            ImGui::SetTooltip("%s", status.c_str());
        ImGui::SameLine(std::max(200.f, d.x - 195));
        ImGui::TextDisabled("%zu nodes / %zu assets", history.scene["nodes"].size(), history.scene["assets"].size());
        ImGui::End();
        ImGui::PopStyleVar();
        viewportRect = {left, top, center, std::max(1.f, d.y - top - bottom)};
        drawDialogs();
        if (!showUnsaved && (ImGui::GetIO().KeyCtrl || ImGui::GetIO().KeySuper) && ImGui::IsKeyPressed(ImGuiKey_S))
            action([this] { save(); });
        if (!ImGui::GetIO().WantTextInput && !showUnsaved)
        {
            if ((ImGui::GetIO().KeyCtrl || ImGui::GetIO().KeySuper) && ImGui::IsKeyPressed(ImGuiKey_D))
                action([this] { treeCommand("duplicate"); });
            if (ImGui::IsKeyPressed(ImGuiKey_Delete) && !selections.empty())
                action([this] { treeCommand("delete"); });
        }
        tools.draw(
          history,
          mainPreview,
          selected,
          selections,
          *window,
          {viewportRect[0], viewportRect[1]},
          {viewportRect[2], viewportRect[3]},
          {viewportRect[2], viewportRect[3]},
          assetBounds,
          [this](const std::string& asset, const editor::Json& t) {
              action([this, asset, t] { createResource(asset, t); });
          },
          [this](bool all) { action([this, all] { frame(all ? "" : selected); }); },
          [this](const std::string& id, bool additive) {
              auto next = selections;
              if (id.empty())
              {
                  if (!additive)
                      select("");
                  return;
              }
              auto it = std::find(next.begin(), next.end(), id);
              if (additive)
              {
                  if (it == next.end())
                      next.push_back(id);
                  else
                      next.erase(it);
                  selectMany(next);
              }
              else if (it != next.end() && next.size() > 1)
              {
                  next.erase(it);
                  next.push_back(id);
                  selectMany(next);
              }
              else
                  select(id);
              if (selections.size() > 1)
              {
                  assetInspectorTab = 0;
                  lightInspector    = false;
              }
          },
          [this](const std::string& error) { status = error; },
          [this](render::OrbitCamera camera) { action([this, camera] { window->SetCamera(camera); }); });
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {5, 4});
        panel("##ViewportOptions", {std::max(8.f, center - 234), top + 8}, {226, 36}, false);
        ImGui::BeginDisabled(tools.drag.has_value());
        if (ImGui::Button(
              mainPreview                        ? "Editor view"
              : window->GetCamera().orthographic ? "Orthographic"
                                                 : "Perspective"))
            action([this] {
                if (mainPreview)
                {
                    toggleMainPreview();
                    return;
                }
                auto c         = window->GetCamera();
                c.orthographic = !c.orthographic;
                window->SetCamera(c);
            });
        ImGui::SameLine();
        if (ImGui::Button(lit ? "Lit" : "Unlit"))
        {
            lit = !lit;
            queueLighting();
        }
        ImGui::EndDisabled();
        ImGui::End();
        ImGui::PopStyleVar();
    }
    void syncScene()
    {
        const auto root = assetRoot.empty() ? projectRoot() : assetRoot;
        if (renderDocument == history.scene && renderRoot == root.string())
            return;
        const auto                      worlds = editor::worldMatrices(history.scene);
        std::vector<render::SceneAsset> assets;
        for (auto it = history.scene["assets"].begin(); it != history.scene["assets"].end(); ++it)
            assets.push_back(
              {it.key(),
               resolveAsset(root, it.value()["path"].get<std::string>()),
               it.value().value("sourceSpace", false)});
        std::vector<render::SceneInstance> instances;
        for (const auto& n : history.scene["nodes"])
            if (n.contains("assetId") && !editor::inheritedFlag(history.scene, n["id"].get<std::string>(), "hidden"))
                instances.push_back(
                  {n["id"].get<std::string>(), n["assetId"].get<std::string>(), worlds.at(n["id"].get<std::string>())});
        const auto userCount = instances.size();
        for (const auto& asset : assets)
        {
            bool referenced = false;
            for (const auto& i : instances)
                if (i.assetId == asset.id)
                    referenced = true;
            if (!referenced)
            {
                std::string id   = "__nova_resource_" + asset.id;
                auto        used = [&] {
                    for (const auto& a : assets)
                        if (a.id == id)
                            return true;
                    for (const auto& i : instances)
                        if (i.id == id)
                            return true;
                    return false;
                };
                while (used())
                    id += "_";
                editor::Matrix zero{};
                zero[15] = 1;
                instances.push_back({id, asset.id, zero, false});
            }
        }

        std::ifstream helperFile(helperRoot / "manifest.json");
        if (!helperFile)
            throw std::runtime_error("Missing viewport helper resources");
        auto helpers = editor::Json::parse(helperFile);
        for (const auto& helper : helpers)
        {
            std::string id   = "__nova_viewport_" + helper["name"].get<std::string>();
            auto        used = [&] {
                for (const auto& a : assets)
                    if (a.id == id)
                        return true;
                for (const auto& i : instances)
                    if (i.id == id)
                        return true;
                return false;
            };
            while (used())
                id += "_";
            assets.push_back({id, helperRoot / (helper["name"].get<std::string>() + ".glb")});
            instances.push_back({id, id, helper["world"].get<editor::Matrix>(), false});
        }
        window->SetScene(assets, instances);
        assetBounds.clear();
        for (auto it = history.scene["assets"].begin(); it != history.scene["assets"].end(); ++it)
            if (auto b = window->GetSceneAssetBounds(it.key()))
                assetBounds[it.key()] = {
                  {b->minimum[0], b->minimum[1], b->minimum[2]}, {b->maximum[0], b->maximum[1], b->maximum[2]}};
        if (!pendingFocus.empty())
        {
            auto id = pendingFocus;
            pendingFocus.clear();
            frame(id == "*" ? "" : id);
        }
        renderDocument = history.scene;
        renderRoot     = root.string();
        preview        = std::to_string(userCount) + " rendered instances";
    }
    void createResource(const std::string& asset, const editor::Json& transform)
    {
        if (!history.scene["assets"].contains(asset))
            return;
        auto        id   = uuid();
        std::string base = history.scene["assets"][asset].value(
          "name", std::filesystem::path(history.scene["assets"][asset]["path"].get<std::string>()).stem().string());
        if (!history.scene["assets"][asset].contains("name"))
            for (const auto& n : history.scene["nodes"])
                if (n.value("assetId", "") == asset)
                {
                    base = n["name"].get<std::string>();
                    break;
                }
        change([&](auto& s) {
            s["assets"][asset]["name"] = base;
            std::string label          = base;
            int         index          = 2;
            auto        used           = [&] {
                for (const auto& n : s["nodes"])
                    if (n["name"] == label)
                        return true;
                return false;
            };
            while (used())
                label = base + " " + std::to_string(index++);
            s["nodes"].push_back(
              {{"id", id}, {"parentId", nullptr}, {"name", label}, {"assetId", asset}, {"transform", transform}});
        });
        select(id);
        status = "Model instance placed";
    }
    void landSelected()
    {
        editor::assertEditable(history.scene, {selected});
        auto next = editor::groundedTransform(
          history.scene, selected, assetBounds, editor::sceneSurfaceQuery(*window, history.scene));
        if (!next)
        {
            status = "Cannot ground: no model bounds or singular parent";
            return;
        }
        auto id = selected;
        change([&](auto& s) {
            for (auto& n : s["nodes"])
                if (n["id"] == id)
                    n["transform"] = *next;
        });
        status = "Dropped onto model or ground";
    }
    void frame(const std::string& id)
    {
        auto           c = window->GetCamera();
        editor::Camera camera{c.yaw, c.pitch, c.distance, c.orthographic, {c.target[0], c.target[1], c.target[2]}};
        auto           box = editor::sceneBounds(history.scene, assetBounds, id);
        if (!id.empty())
        {
            const auto& n = editor::nodeById(history.scene, id);
            if (n.contains("camera") || n.contains("light"))
            {
                auto p = editor::pivot(editor::worldMatrices(history.scene).at(id));
                box    = editor::Bounds{editor::add(p, {-1, -1, -1}), editor::add(p, {1, 1, 1})};
            }
        }
        if (!id.empty() && id == selected && selections.size() > 1)
        {
            box.reset();
            for (const auto& root : editor::selectionRoots(history.scene, selections))
            {
                auto b = editor::sceneBounds(history.scene, assetBounds, root);
                if (b)
                {
                    if (!box)
                        box = b;
                    else
                        for (int k = 0; k < 3; k++)
                        {
                            box->minimum[k] = std::min(box->minimum[k], b->minimum[k]);
                            box->maximum[k] = std::max(box->maximum[k], b->maximum[k]);
                        }
                }
            }
        }
        auto next  = editor::frameBounds(camera, box, {viewportRect[2], viewportRect[3]});
        c.distance = float(next.distance);
        for (int k = 0; k < 3; k++)
            c.target[k] = float(next.target[k]);
        window->SetCamera(c);
    }
    void flush()
    {
        auto actions = std::move(pending);
        pending.clear();
        for (auto& fn : actions)
            try
            {
                fn();
            }
            catch (const std::exception& e)
            {
                status = std::string("Error: ") + e.what();
            }
        auto validSelection = selections;
        validSelection.erase(
          std::remove_if(
            validSelection.begin(),
            validSelection.end(),
            [&](const std::string& id) {
                for (const auto& n : history.scene["nodes"])
                    if (n["id"] == id)
                        return false;
                return true;
            }),
          validSelection.end());
        if (validSelection != selections)
            selectMany(validSelection);
        try
        {
            autosave();
        }
        catch (const std::exception& e)
        {
            recoveryStatus = std::string("Recovery failed: ") + e.what();
            changedAt      = std::chrono::steady_clock::now();
        }
        try
        {
            prepareAssetInspector();
        }
        catch (const std::exception& e)
        {
            status = e.what();
        }
        try
        {
            syncScene();
            syncSceneObjects();
        }
        catch (const std::exception& e)
        {
            status = std::string("Scene error: ") + e.what();
        }
    }
};
#ifndef NOVA_EDITOR_TEST
int main(int argc, char** argv)
{
    try
    {
        int         limit = 0;
        std::string model;
        Editor      editor;
        auto        executableDir = std::filesystem::absolute(argv[0]).parent_path();
#ifdef __APPLE__
        editor.helperRoot = executableDir / "../Resources/viewport";
#else
        editor.helperRoot = executableDir / "resources/viewport";
#endif
        for (int i = 1; i < argc; ++i)
        {
            std::string arg = argv[i];
            if (arg == "--frames" && i + 1 < argc)
                limit = std::stoi(argv[++i]);
            else if (arg == "--model" && i + 1 < argc)
                model = argv[++i];
            else if (arg == "--recovery-dir" && i + 1 < argc)
                editor.recoveryBase = std::filesystem::absolute(argv[++i]);
            else if (arg == "--project" && i + 1 < argc)
                std::snprintf(editor.projectPath, sizeof(editor.projectPath), "%s", argv[++i]);
            else
                throw std::runtime_error(
                  "Usage: nova_editor [--frames N] [--model file.glb] [--project project.json] [--recovery-dir "
                  "directory]");
        }
        // GLFW on macOS may change cwd to the app resource directory during initialization.
        const auto absoluteProject = std::filesystem::absolute(editor.projectPath).string();
        std::snprintf(editor.projectPath, sizeof(editor.projectPath), "%s", absoluteProject.c_str());
        if (!model.empty())
            model = std::filesystem::absolute(model).string();
        render::WindowConfig config;
        config.width  = 1440;
        config.height = 900;
        config.title  = "Nova Editor - Native";
        render::Window window(config);
        editor.window = &window;
        window.SetClearColor({.6f, .6f, .6f, 1});
        window.SetLighting(render::LightingMode::PBR);
        window.SetDirectionalLight(editor.studio.light());
        window.SetShadows({editor.studio.shadows, editor.studio.softness});
        auto environment           = window.GetEnvironment();
        environment.showBackground = false;
        window.SetEnvironment(environment);
        window.EnableOrbitControls(false);
        window.SetCloseOnEscape(false);
        auto camera     = window.GetCamera();
        camera.distance = 8.0f;
        camera.pitch    = 20.f;
        camera.yaw      = 25.f;
        window.SetCamera(camera);
        render::ParameterPanelConfig panel;
        panel.showBuiltinPanel  = false;
        const auto  framebuffer = window.GetFramebufferSize();
        const float dpi         = std::max(1.f, float(framebuffer[0]) / config.width);
        panel.configureUI       = [dpi] { editor::theme::configure(dpi); };
        panel.drawUI            = [&] { editor.draw(); };
        panel.sceneViewport     = [&] { return editor.viewportRect; };
        if (!window.EnableParameterPanel(panel))
            throw std::runtime_error("SDK must be built with UI enabled");
        if (std::filesystem::exists(editor.projectPath))
            editor.open();
        if (!model.empty())
        {
            std::snprintf(editor.modelPath, sizeof(editor.modelPath), "%s", model.c_str());
            editor.importModel();
        }
        editor.scanRecovery();
        editor.syncScene();
        std::cout << "Scene camera distance: " << window.GetCamera().distance << std::endl;
        int frames = 0;
        while (!limit || frames < limit)
        {
            if (!window.PollEvents())
            {
                editor.commitNameDraft();
                if (editor.exitApproved || !editor.dirty())
                    break;
                if (!editor.nativeHandle)
                {
                    editor.autosave(true);
                    break;
                }
                glfwSetWindowShouldClose(editor.nativeHandle, GLFW_FALSE);
                editor.history.cancelPreview();
                editor.requestClose = true;
                editor.showUnsaved  = true;
            }
            if (editor.exitApproved)
                break;
            if (window.DrawFrame() == render::FrameResult::Rendered)
                ++frames;
            editor.flush();
        }
        if (!editor.exitApproved)
            editor.autosave(true);
        window.WaitIdle();
        std::cout << "Editor rendered " << frames << " frames; validation errors: " << window.ValidationErrorCount()
                  << '\n';
        return window.ValidationErrorCount() ? 1 : 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}

#endif
