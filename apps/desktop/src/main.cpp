#include "ScenePreview.hpp"
#include "FbxConversion.hpp"
#include "ObjMaterials.hpp"
#include "MeshFormats.hpp"
#include "ConvertGLTF.hpp"
#include "ExportGLB.hpp"
#include "PrepareGLTFImport.hpp"
#include "AssetInspector.hpp"
#include "AssetPreview.hpp"
#include "Hierarchy.hpp"
#include "Lighting.hpp"
#include "ModelEditing.hpp"
#include "Persistence.hpp"
#include "RenderBridge.hpp"
#include "SceneObjectInspector.hpp"
#include "WorldInspector.hpp"
#define GLFW_INCLUDE_NONE
#include "Navigation.hpp"
#include "Scene.hpp"
#include "Theme.hpp"
#include "Transforms.hpp"
#include "Viewport.hpp"
#ifndef NOVA_EDITOR_WINDOW_HOST_CONTROLS
#include <GLFW/glfw3.h>
#else
#include <SDL3/SDL.h>
#include <mutex>
#endif
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
static double editorClockSeconds()
{
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

struct Editor
{
    std::filesystem::path variantListPath;
    std::vector<std::string> variantNames;
    editor::History        history;
    editor::ViewportTools  tools;
    editor::AssetBounds    assetBounds;
    double lastRenderedFrame = 0, averageFrameInterval = 0, lastStatsRefresh = 0;
    char frameStatsLabel[64] = "FPS -- | -- ms";

    void syncOutlines()
    {
        render::SceneOutlines next;
        if (!runtimeScene && !mainPreview)
        {
            const auto selectedNodes = editor::subtreeIds(history.scene, selections);
            for (const auto& node : history.scene["nodes"])
            {
                if (!node.contains("assetId")) continue;
                const auto id = node["id"].get<std::string>();
                if (id != tools.hoveredId && !selectedNodes.count(id)) continue;
                if (editor::inheritedFlag(history.scene, id, "hidden")) continue;
                if (selectedNodes.count(id))
                    next.selectedIds.push_back(id);
                else
                    next.hoveredId = id;
            }
        }
        if (next.hoveredId != appliedOutlines.hoveredId || next.selectedIds != appliedOutlines.selectedIds)
        {
            window->SetSceneOutlines(next);
            appliedOutlines = std::move(next);
        }
    }

    render::SceneOutlines appliedOutlines;

    void recordViewportFrame(double now)
    {
        const double interval = now - lastRenderedFrame;
        lastRenderedFrame = now;
        if (interval <= 0 || interval >= .75)
        {
            averageFrameInterval = 0;
            return;
        }
        averageFrameInterval = averageFrameInterval > 0 ? averageFrameInterval * .85 + interval * .15 : interval;
        if (now - lastStatsRefresh >= .25)
        {
            std::snprintf(frameStatsLabel, sizeof(frameStatsLabel), "%.0f FPS | %.1f ms",
                          1.0 / averageFrameInterval, averageFrameInterval * 1000);
            lastStatsRefresh = now;
        }
    }
    std::array<float, 4>   viewportRect{0, 24, 1110, 821};
    std::string            pendingFocus;
    struct CameraFocus
    {
        editor::OrbitCamera from, to;
        double started;
    };
    std::optional<CameraFocus> cameraFocus;
    bool                   lit               = true;
    bool                   lightInspector    = false;
    int                    assetInspectorTab = 0;
    editor::AssetInspector assetInspector;
    editor::WorldInspector worldInspector;
    std::string            environmentKey;
    int                    sidebarTab = 0;
    bool                   assetsOpen = false, focusProjectPath = false, focusModelPath = false;
    editor::assets::AssetPreviews assetPreviews;
    float                  scenePanelHeight = 285;

    render::RenderMode renderMode = render::RenderMode::Raster;
    std::optional<render::RasterSettings> rasterBeforeHybrid;
    void               setRenderMode(render::RenderMode value)
    {
        if (!window)
            throw std::runtime_error("Renderer unavailable");
        if (value == render::RenderMode::Hybrid)
        {
            const auto caps = window->GetHybridCapabilities();
            if (!caps.supported)
                throw std::runtime_error(caps.reason);
            auto settings = window->GetHybrid();
            settings.reflections = true;
            settings.ambientOcclusion = true;
            settings.temporalReconstruction = caps.temporalReconstruction;
            if (settings.temporalReconstruction)
            {
                settings.shadowSamples = 1;
                settings.aoSamples = 1;
            }
            window->SetHybrid(settings);
            const auto raster = window->GetRasterSettings();
            window->SetRenderMode(value);
            rasterBeforeHybrid = raster;
        }
        else
        {
            if (value == render::RenderMode::RayTracing)
            {
                auto settings = window->GetRayTracing();
                const auto lamps = window->GetLights();
                if (std::any_of(lamps.begin(), lamps.end(), [](const auto& light) {
                    return light.enabled && light.type == render::LightType::Rectangle;
                }))
                    settings.integrator = render::PathIntegrator::PathTracing;
                settings.maxBounces = 3;
                settings.resolutionScale = .5f;
                settings.denoise = true;
                window->SetRayTracing(settings);
            }
            window->SetRenderMode(value);
            if (rasterBeforeHybrid)
            {
                window->SetRasterSettings(*rasterBeforeHybrid);
                rasterBeforeHybrid.reset();
            }
        }
        renderMode = value;
        sceneViewKey.clear();
    }
    void setIntegrator(render::PathIntegrator value)
    {
        auto settings       = window->GetRayTracing();
        settings.integrator = value;
        window->SetRayTracing(settings);
    }
    editor::StudioSettings studio;
    editor::Json           saved = editor::emptyScene();
    std::string            selected, status = editor::language::text("Ready", "就绪"), preview;
    int meshExportFormat = 0;
    static std::string modelExtension(const std::filesystem::path& path)
    {
        auto extension = path.extension().string();
        std::transform(extension.begin(), extension.end(), extension.begin(), [](unsigned char c) { return std::tolower(c); });
        return extension;
    }

    char                   glbExportPath[1024] = "output/scene.glb";
    bool                   exportSelectionOnly = false, showGLBExport = false;
    char                   projectPath[1024] = "output/workspace/project.json", modelPath[1024] = "", name[256] = "";
    std::vector<std::function<void()>>    pending;
    editor::RenderWindow*                 window = nullptr;
    std::filesystem::path                 assetRoot, helperRoot;
    std::optional<editor::Json> runtimeScene;
    double runtimeSeconds = 0;
    std::vector<render::SceneAsset> previewAssets;
    std::vector<render::SceneInstance> authoredInstances;
    size_t previewInstanceCount = 0;

    bool hasPreviewBehavior() const
    {
        for (const auto& node : history.scene["nodes"])
            if (node.contains("previewBehavior")) return true;
        return false;
    }

    void stopScenePreview()
    {
        runtimeScene.reset();
        try
        {
            window->SetScene(previewAssets, authoredInstances);
        }
        catch (...)
        {
            renderDocument = editor::Json();
            throw;
        }
        status = "Scene preview stopped";
    }

    void toggleScenePreview()
    {
        if (runtimeScene) { stopScenePreview(); return; }
        if (!window || history.previewBase || renderMode != render::RenderMode::Raster || !hasPreviewBehavior()) return;
        runtimeScene = history.scene;
        runtimeSeconds = 0;
        status = "Scene preview playing";
    }

    void advanceScenePreview(float delta)
    {
        if (!runtimeScene) return;
        try
        {
            if (*runtimeScene != history.scene)
            {
                stopScenePreview();
                return;
            }
            runtimeSeconds += delta;
            const auto worlds = editor::previewWorldMatrices(*runtimeScene, runtimeSeconds);
            auto posed = authoredInstances;
            for (size_t index = 0; index < previewInstanceCount; ++index)
                posed[index].world = worlds.at(posed[index].id);
            window->SetScene(previewAssets, posed);
        }
        catch (const std::exception& error)
        {
            runtimeScene.reset();
            renderDocument = editor::Json();
            status = std::string("Scene preview failed: ") + error.what();
        }
    }

    void drawBehavior(const editor::Json& node)
    {
        if (node.contains("camera") || node.contains("light")) return;
        auto behavior = node.value("previewBehavior", editor::Json::object());
        const auto kind = behavior.value("kind", "");
        int type = kind == "spin" ? 1 : kind == "bob" ? 2 : 0;
        float amount = behavior.value("amount", 0.f);
        bool changed = ImGui::Combo(editor::language::text("Preview behavior", "预览行为"), &type, "None\0Spin\0Bob\0");
        if (changed) amount = type == 1 ? 60.f : .5f;
        if (type)
            changed |= ImGui::SliderFloat(type == 1 ? "Degrees / second" : "Amplitude",
                &amount, type == 1 ? -360.f : 0.f, type == 1 ? 360.f : 10.f, "%.1f", ImGuiSliderFlags_AlwaysClamp);
        if (changed)
            action([this, id = selected, type, amount] {
                change([&](auto& scene) {
                    for (auto& target : scene["nodes"])
                    {
                        if (target["id"] != id) continue;
                        if (!type) target.erase("previewBehavior");
                        else target["previewBehavior"] = {{"kind", type == 1 ? "spin" : "bob"}, {"amount", amount}};
                    }
                });
            });
    }
    editor::Json                          renderDocument;
    std::string                           renderRoot;
    std::vector<std::string>              selections;
    char                                  search[256] = "";
    std::string                           anchor, recoveryStatus = "Recovery ready", currentProjectPath;
    std::filesystem::path                 recoveryBase = editor::defaultRecoveryRoot(), recoveryFolder;
    std::vector<std::filesystem::path>    recoveries;
    editor::Json                          observed, recoveredSnapshot;
    std::chrono::steady_clock::time_point changedAt       = std::chrono::steady_clock::now();
#ifndef NOVA_EDITOR_WINDOW_HOST_CONTROLS
    GLFWwindow*                           nativeHandle = nullptr;
#endif
    bool                                  renameRequested = false, nameDraftDirty = false;
    bool                                  requestClose = false, exitApproved = false, showUnsaved = false;
    std::string                           requestedOpen;
    bool                                  requestedNew = false, recoveryDismissed = false;
    bool                                  dirty() const { return history.scene != saved; }
    void                                  action(std::function<void()> fn) { if (!runtimeScene) pending.push_back(std::move(fn)); }
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
    editor::OrbitCamera          editorCamera;
    std::string                  sceneViewKey, cameraNotice;
    void addShowcaseLights()
    {
        const auto box = editor::sceneBounds(history.scene, assetBounds, "");
        editor::V3 target{};
        double scale = box ? .1 : 1.;
        if (box)
            for (size_t k = 0; k < target.size(); ++k)
            {
                target[k] = (box->minimum[k] + box->maximum[k]) / 2;
                scale = std::max(scale, (box->maximum[k] - box->minimum[k]) / 16);
            }
        change([&](auto& s) {
            s["schemaVersion"] = std::max(7, s["schemaVersion"].template get<int>());
            auto addLamp = [&](const char* name, editor::V3 offset, double size, editor::V3 color, double power) {
                auto id = uuid();
                auto lamp = editor::createLight(id, "rectangle");
                lamp["name"] = name;
                lamp["transform"]["position"] = editor::add(target, editor::times(offset, scale));
                lamp["light"]["width"] = lamp["light"]["height"] = size * scale;
                lamp["light"]["color"] = color;
                lamp["light"]["active"] = true;
                constexpr double pi = 3.141592653589793;
                lamp["light"]["intensity"] = power / (pi * size * size);
                s["nodes"].push_back(std::move(lamp));
                editor::aimObject(s, id, std::atan2(offset[0], offset[2]) * 180 / pi,
                  std::atan2(offset[1], std::hypot(offset[0], offset[2])) * 180 / pi);
            };
            addLamp(editor::language::text("Warm key", "暖色主光"), {-3, 8, 5}, 6, {1, .83, .65}, 1350);
            addLamp(editor::language::text("Cool fill", "冷色补光"), {4, 6, -4}, 5, {.72, .83, 1}, 720);
        });
    }
    void                         addSceneObject(const std::string& kind, const std::string& lightType = "directional")
    {
        auto id   = uuid();
        auto node = kind == "camera" ? editor::createCamera(id, window ? window->GetCamera() : editorCamera)
                                     : editor::createLight(id, lightType);
        change([&](auto& s) {
            s["schemaVersion"] = std::max(kind == "light" ? 7 : 5, s["schemaVersion"].template get<int>());
            s["nodes"].push_back(node);
            bool active = false;
            for (const auto& n : s["nodes"])
                if (n.contains(kind) && n[kind][kind == "camera" ? "primary" : "active"] == true)
                    active = true;
            if (kind == "light" || !active)
                editor::setPrimary(s, id, kind);
        });
        select(id);
        sidebarTab        = 0;
        assetInspectorTab = 0;
        lightInspector    = false;
    }
    void toggleMainPreview()
    {
        cameraFocus.reset();
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
        auto color = editor::worldColor(world["background"]["color"], false);
        window->SetClearColor({color[0], color[1], color[2], 1});
        auto light = editor::sceneDirectional(history.scene);
        window->SetLighting(lit ? render::LightingMode::PBR : render::LightingMode::Unlit);
        if (renderMode == render::RenderMode::RayTracing
            && window->GetRayTracing().integrator != render::PathIntegrator::PathTracing)
        {
            const auto lamps = editor::sceneLights(history.scene);
            if (std::any_of(lamps.begin(), lamps.end(), [](const auto& light) {
                return light.enabled && light.type == render::LightType::Rectangle;
            }))
                setIntegrator(render::PathIntegrator::PathTracing);
        }
        editor::applySceneLights(*window, history.scene, studio.light(), {studio.shadows, studio.softness});
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
    std::set<std::string> playingAnimations;

    void advanceAnimations(float delta)
    {
        for (auto it = playingAnimations.begin(); it != playingAnimations.end();)
        {
            try
            {
                if (window->GetAnimationState(*it).playing)
                {
                    ++it;
                    continue;
                }
            }
            catch (const std::exception&) {} // Removed or hidden instance.
            it = playingAnimations.erase(it);
        }
        if (!playingAnimations.empty())
            window->UpdateAnimations(delta);
    }

    void drawAnimation(const editor::Json& node)
    {
        if (!window || !node.contains("assetId") || editor::inheritedFlag(history.scene, selected, "hidden"))
            return;
        std::vector<render::AnimationClip> clips;
        render::AnimationState state;
        try
        {
            clips = window->GetAnimations(node["assetId"].get<std::string>());
            if (clips.empty())
                return;
            state = window->GetAnimationState(selected);
        }
        catch (const std::exception&) { return; } // Scene has not committed yet.
        editor::theme::heading(editor::language::text("Animation", "动画"));
        bool changed = false;
        const auto clipLabel = [&](size_t index) {
            return clips[index].name.empty() ? "Clip " + std::to_string(index + 1) : clips[index].name;
        };
        if (ImGui::BeginCombo(editor::language::text("Clip", "片段"), clipLabel(state.clip).c_str()))
        {
            for (size_t i = 0; i < clips.size(); ++i)
            {
                ImGui::PushID(static_cast<int>(i));
                if (ImGui::Selectable(clipLabel(i).c_str(), state.clip == i))
                {
                    state.clip = static_cast<uint32_t>(i);
                    state.time = 0;
                    changed = true;
                }
                ImGui::PopID();
            }
            ImGui::EndCombo();
        }
        const float duration = clips[state.clip].duration;
        if (ImGui::Button(state.playing ? editor::language::text("Pause", "暂停") : editor::language::text("Play", "播放")))
        {
            state.playing = !state.playing;
            if (state.playing && state.time >= duration)
                state.time = 0;
            changed = true;
        }
        changed |= ImGui::SliderFloat("Time (seconds)", &state.time, 0, duration);
        changed |= ImGui::SliderFloat(editor::language::text("Speed", "速度"), &state.speed, .1f, 4.f, "%.1fx");
        if (changed)
            action([this, state, id = selected] {
                window->SetAnimationState(id, state);
                if (state.playing)
                    playingAnimations.insert(id);
                else
                    playingAnimations.erase(id);
            });
    }

    void drawSceneNodeProperties(const editor::Json& node)
    {
        auto id   = node["id"].get<std::string>(),
             kind = node.contains("camera") ? std::string("camera") : std::string("light");
        sceneObjectInspector.draw(
          node,
          mainPreview,
          cameraNotice,
          [this, id, kind](editor::Json component, double yaw, double pitch, double roll) {
              action([this, id, kind, component, yaw, pitch, roll] {
                  change([&](auto& s) {
                      editor::aimObject(s, id, yaw, pitch, roll);
                      for (auto& n : s["nodes"])
                          if (n["id"] == id)
                          {
                              n[kind] = component;
                              s["schemaVersion"] = std::max(
                                kind == "light"
                                  ? (component["type"] == "rectangle" ||
                                      (component["type"] != "directional" && component["shadows"].template get<bool>())
                                       ? 7
                                       : 6)
                                  : 5,
                                s["schemaVersion"].template get<int>());
                          }
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
        ImGui::TextDisabled("%s", editor::language::text("Coordinates", "坐标系"));
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
            if (editor::theme::vector(std::string(field) == "position" ? editor::language::text("Position", "位置") : editor::language::text("Scale", "缩放"), field, v))
                groupDraft[field] = std::vector<float>(v, v + 3);
        }
        auto angles = editor::quaternionEuler(groupDraft["rotation"]);
        if (editor::theme::vector(editor::language::text("Rotation °", "旋转 °"), "rotation", angles.data(), "%.1f"))
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
          [this, id](editor::Json material, std::array<std::string, editor::assets::textureSlotCount> paths, std::array<bool, editor::assets::textureSlotCount> remove) {
              action([this, id, material, paths, remove] {
                  auto doc = selectedAsset(id);
                  for (size_t i = 0; i < paths.size(); i++)
                  {
                      if (!paths[i].empty())
                          doc = editor::assets::applyTexture(
                            doc, editor::assets::textureSlots[i], editor::assets::readBytes(paths[i]));
                      else if (remove[i])
                          doc = editor::assets::applyTexture(doc, editor::assets::textureSlots[i], std::nullopt);
                  }
                  if (window)
                  {
                      const auto assetId = editor::nodeById(history.scene, id)["assetId"].get<std::string>();
                      if (window->GetSceneAssetBounds(assetId))
                      {
                          auto slots = window->GetMaterials(assetId);
                          for (uint32_t slot = 0; slot < slots.size(); slot++)
                          {
                              auto value = slots[slot];
                              value.name = material["name"];
                              for (int k = 0; k < 3; k++)
                              {
                                  value.baseColor[k] = material["color"][k];
                                  value.emissive[k]  = material["emissive"][k];
                              }
                              value.baseColor[3] = material["opacity"];
                              const auto alphaMode = material["alphaMode"].get<std::string>();
                              value.alphaMode = alphaMode == "MASK"    ? render::AlphaMode::Mask
                                                : alphaMode == "BLEND" ? render::AlphaMode::Blend
                                                                       : render::AlphaMode::Opaque;
                              value.alphaCutoff = material["alphaCutoff"];
                              value.doubleSided = material["doubleSided"];
                              value.metallic                       = material["metallic"];
                              value.roughness                      = material["roughness"];
                              value.normalScale                    = material["normalScale"];
                              value.occlusionStrength              = material["occlusion"];
                              std::optional<render::Image>* maps[] = {
                                &value.baseColorTexture,
                                &value.normalTexture,
                                &value.metallicRoughnessTexture,
                                &value.occlusionTexture,
                                &value.emissiveTexture};
                              for (size_t k = 0; k < 5; k++)
                              {
                                  if (!paths[k].empty())
                                      *maps[k] = render::LoadMaterialImage(paths[k]);
                                  else if (remove[k])
                                      maps[k]->reset();
                              }
                              window->SetMaterial(slot, value, assetId);
                          }
                      }
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
        status       = editor::language::text("New project", "新建项目");
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
        assetsOpen = !s["assets"].empty();
        assetPreviews.clear();
        saved              = s;
        assetRoot          = root;
        currentProjectPath = std::filesystem::absolute(projectPath).string();
        select("");
        status       = editor::language::text("Opened project", "已打开项目");
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
    bool continueAfterClose(render::Window& window)
    {
        commitNameDraft();
        if (exitApproved || !dirty())
            return false;
#ifdef NOVA_EDITOR_WINDOW_HOST_CONTROLS
        window.CancelClose();
#else
        if (!nativeHandle)
        {
            autosave(true);
            return false;
        }
        glfwSetWindowShouldClose(nativeHandle, GLFW_FALSE);
#endif
        if (runtimeScene)
        {
            runtimeScene.reset();
            renderDocument = editor::Json();
        }
        history.cancelPreview();
        requestClose = true;
        showUnsaved  = true;
        return true;
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
    void exportModel(const std::filesystem::path& path, int format,
                     const std::optional<std::vector<std::string>>& selection)
    {
        if (history.previewBase.has_value()) throw std::runtime_error("Finish transform before export");
        auto target = std::filesystem::absolute(path);
        static constexpr const char* extensions[]{".glb", ".obj", ".stl", ".gltf", ".fbx"};
        const auto extension = extensions[format];
        if (target.extension().empty()) target += extension;
        if (modelExtension(target) != extension)
            throw std::runtime_error(std::string("Output must use ") + extension);
        if (format == 1 || format == 3) target.replace_extension();
        if (std::filesystem::exists(target)) throw std::runtime_error("File exists; choose a new output path");
        auto root = assetRoot.empty() ? projectRoot() : assetRoot;
        auto data = editor::assets::exportGLB(history.scene, [&](const std::string& path) {
            return editor::assets::readBytes(editor::safeAssetPath(root, path));
        }, selection);
        if (format == 1 || format == 3)
        {
            const auto files = format == 1 ? editor::assets::glbToOBJ(data) : editor::assets::splitGLB(data);
            auto staging = target;
            staging += ".tmp-" + uuid();
            std::filesystem::create_directories(staging);
            try
            {
                for (const auto& [name, bytes] : files)
                {
                    std::ofstream out(staging / name, std::ios::binary);
                    out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
                    out.close();
                    if (!out) throw std::runtime_error("Cannot write model resource bundle");
                }
                if (std::filesystem::exists(target)) throw std::runtime_error("Output already exists");
                std::filesystem::rename(staging, target);
            }
            catch (...)
            {
                std::error_code ignored;
                std::filesystem::remove_all(staging, ignored);
                throw;
            }
            status = "Exported model folder: " + target.string();
            return;
        }
        if (format == 2) data = editor::assets::glbToMesh(data, true);
        std::filesystem::create_directories(target.parent_path());
        auto staging = target.parent_path() / (".nova-export-" + uuid());
        std::filesystem::create_directory(staging);
        try
        {
            auto input = staging / "scene.glb";
            auto output = staging / (std::string("scene") + extension);
            std::ofstream stream(format == 4 ? input : output, std::ios::binary);
            stream.write(reinterpret_cast<const char*>(data.data()), static_cast<std::streamsize>(data.size()));
            stream.close();
            if (!stream) throw std::runtime_error("Cannot write model");
            if (format == 4)
                editor::assets::convertFBX(helperRoot.parent_path() / "fbx", input, output);
            if (std::filesystem::exists(target)) throw std::runtime_error("Output already exists");
            std::filesystem::rename(output, target);
        }
        catch (...)
        {
            std::error_code ignored;
            std::filesystem::remove_all(staging, ignored);
            throw;
        }
        std::error_code ignored;
        std::filesystem::remove_all(staging, ignored);
        status = "Exported model: " + target.string();
    }

#ifdef NOVA_EDITOR_WINDOW_HOST_CONTROLS
    struct FileChoice
    {
        std::mutex mutex;
        bool ready = false;
        std::string path, error;
    };
    std::shared_ptr<FileChoice> fileChoice;
    std::function<void(const std::string&)> fileChosen;

    void chooseFile(const SDL_DialogFileFilter& filter, bool save, std::function<void(const std::string&)> next)
    {
        if (fileChoice) return;
        fileChoice = std::make_shared<FileChoice>();
        fileChosen = std::move(next);
        auto data = new std::shared_ptr<FileChoice>(fileChoice);
        const auto complete = [](void* opaque, const char* const* files, int) {
            std::unique_ptr<std::shared_ptr<FileChoice>> result(static_cast<std::shared_ptr<FileChoice>*>(opaque));
            std::lock_guard lock((*result)->mutex);
            if (!files) (*result)->error = SDL_GetError();
            else if (files[0]) (*result)->path = files[0];
            (*result)->ready = true;
        };
        auto window = SDL_GetKeyboardFocus();
        if (save) SDL_ShowSaveFileDialog(complete, data, window, &filter, 1, nullptr);
        else SDL_ShowOpenFileDialog(complete, data, window, &filter, 1, nullptr, false);
    }

    void finishFileChoice()
    {
        if (!fileChoice) return;
        auto result = fileChoice;
        std::lock_guard lock(result->mutex);
        if (!result->ready) return;
        fileChoice.reset();
        auto next = std::move(fileChosen);
        if (!result->error.empty()) status = result->error;
        else if (!result->path.empty())
            action([next = std::move(next), path = result->path] { next(path); });
    }
#endif

    void chooseModelImport()
    {
#ifdef NOVA_EDITOR_WINDOW_HOST_CONTROLS
        static const SDL_DialogFileFilter models{"3D models", "glb;gltf;obj;stl;fbx;step;stp"};
        chooseFile(models, false, [this](const std::string& path) { importModel(path); });
#else
        sidebarTab = 1;
        focusModelPath = true;
#endif
    }

    void importModel(const std::filesystem::path& source = {})
    {
        auto src = std::filesystem::absolute(source.empty() ? std::filesystem::path(modelPath) : source);
        const auto extension = modelExtension(src);
        const bool isStep = extension == ".step" || extension == ".stp";
        const bool isFBX = extension == ".fbx";
        if (extension != ".glb" && extension != ".gltf" && extension != ".obj" && extension != ".stl" && !isStep && !isFBX)
            throw std::runtime_error("Choose a glTF, GLB, OBJ, STL, FBX or STEP file");
        if (assetRoot.empty())
            assetRoot = projectRoot();
        editor::assets::Bytes bytes;
        if (isStep || isFBX)
        {
            const auto staging = std::filesystem::temp_directory_path() / ("nova-model-" + uuid() + ".glb");
            try
            {
                if (isFBX)
                    editor::assets::convertFBX(helperRoot.parent_path() / "fbx", src, staging);
                else
                    editor::assets::runModelConverter(helperRoot.parent_path() / "step/nova_step", src, staging);
                bytes = editor::assets::readBytes(staging);
            }
            catch (...)
            {
                std::error_code error;
                std::filesystem::remove(staging, error);
                throw;
            }
            std::filesystem::remove(staging);
        }
        else
            bytes = editor::assets::readBytes(src);
        if (extension == ".gltf")
            bytes = editor::assets::packGLTF(bytes, [&](const auto& path) {
                return editor::assets::readBytes(editor::safeAssetPath(src.parent_path(), path));
            });
        else if (extension == ".obj")
            bytes = editor::assets::objToGLB(bytes, [&](const std::string& path) {
                return editor::assets::readBytes(editor::safeAssetPath(src.parent_path(), path));
            });
        else if (extension == ".stl") bytes = editor::assets::meshToGLB(bytes, true);
        auto doc = editor::assets::readGLB(bytes);
        const auto id = uuid();
        const auto sceneObjects = editor::assets::prepareGLTFImport(doc, id, uuid);
        if (sceneObjects) bytes = editor::assets::writeGLB(doc);
        const bool hasMeshes = !doc.json.value("meshes", editor::Json::array()).empty();
        const bool animated = !doc.json.value("animations", editor::Json::array()).empty()
                           || !doc.json.value("skins", editor::Json::array()).empty();
        if (animated && renderMode != render::RenderMode::Raster)
            setRenderMode(render::RenderMode::Raster);
        auto draft = history.scene;
        draft["nodes"].push_back(
          {{"id", id}, {"parentId", nullptr}, {"name", src.stem().string()}, {"transform", editor::identity()}});
        bool keptWhole = false;
        for (const auto& mesh : doc.json.value("meshes", editor::Json::array()))
            for (const auto& primitive : mesh.value("primitives", editor::Json::array()))
                keptWhole |= !primitive.value("targets", editor::Json::array()).empty();
        for (const auto& node : doc.json.value("nodes", editor::Json::array()))
            keptWhole |= node.value("extensions", editor::Json::object()).contains("EXT_mesh_gpu_instancing");
        for (const auto& material : doc.json.value("materials", editor::Json::array()))
            keptWhole |= material.value("extensions", editor::Json::object()).contains("KHR_materials_volume");
        keptWhole |= doc.json.value("extensions", editor::Json::object()).contains("KHR_materials_variants");
        if (!animated && !keptWhole && (hasMeshes || !sceneObjects || sceneObjects->empty()))
        {
            try
            {
                writeModelFiles(editor::assets::expandModel(draft, id, editor::assets::decodeModel(bytes), uuid));
            }
            catch (const editor::assets::ModelExpansionBudgetError&)
            {
                keptWhole = true;
            }
        }
        if ((animated || keptWhole) && hasMeshes)
        {
            auto path = "assets/" + id + ".glb";
            draft["assets"][id] = {{"path", path}, {"sourceSpace", true}, {"name", src.filename().string()}};
            draft["nodes"].back()["assetId"] = id;
            writeModelFiles({{path, std::move(bytes)}});
        }
        if (sceneObjects && !sceneObjects->empty())
        {
            draft["schemaVersion"] = 7;
            for (const auto& object : *sceneObjects) draft["nodes"].push_back(object);
        }
        change([&](auto& s) { s = draft; });
        select(id);
        pendingFocus = id;
        preview      = src.stem().string();
        sidebarTab   = 0;
        status       = keptWhole ? "Imported as a whole model (internal nodes and material slots not expanded)"
                                 : "Model imported";
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
            using editor::theme::Icon;
            const auto glyph = n.contains("camera") ? Icon::Camera : n.contains("light") ? Icon::Light
                                    : n.contains("assetId") ? Icon::Mesh : Icon::Group;
            const auto cursor = ImGui::GetCursorScreenPos();
            bool expanded = ImGui::TreeNodeEx("node", flags, "     %s", label.c_str());
            editor::theme::icon(ImGui::GetWindowDrawList(),
                {cursor.x + ImGui::GetTreeNodeToLabelSpacing() + 5,
                 (ImGui::GetItemRectMin().y + ImGui::GetItemRectMax().y) * .5f},
                ImGui::GetColorU32(ImGuiCol_Text), glyph);
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
                if (ImGui::MenuItem(editor::language::text("Rename", "重命名")))
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
            if (ImGui::Button(editor::language::text("Cancel", "取消")))
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
            auto color = editor::worldColor(world["background"]["color"], false);
            window->SetClearColor({color[0], color[1], color[2], 1});
            auto light = editor::sceneDirectional(history.scene);
            editor::applySceneLights(*window, history.scene, config.light(), {config.shadows, config.softness});
        });
    }
    void drawLightSettings()
    {
        if (auto light = editor::sceneDirectional(history.scene))
        {
            editor::theme::heading("Scene lighting");
            ImGui::TextWrapped("Edit individual scene lights. All three types support static opaque shadows.");
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
        ImGui::TextDisabled("%s", editor::language::text("Intensity", "强度"));
        ImGui::SetNextItemWidth(-1);
        changed |=
          ImGui::SliderFloat("##LightIntensity", &studio.intensity, 0, 10, "%.2f", ImGuiSliderFlags_AlwaysClamp);
        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();
        changed |= ImGui::Checkbox(editor::language::text("Cast shadows", "投射阴影"), &studio.shadows);
        ImGui::BeginDisabled(!studio.shadows);
        ImGui::TextDisabled("%s", editor::language::text("Shadow softness", "阴影柔和度"));
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
            editor::theme::heading(editor::language::text("Project", "项目"));
            ImGui::TextWrapped("%s", history.scene["name"].get<std::string>().c_str());
            ImGui::TextDisabled(
              "%zu nodes / %zu assets", history.scene["nodes"].size(), history.scene["assets"].size());
            ImGui::Spacing();
            ImGui::TextDisabled("%s", editor::language::text("Project path", "项目路径"));
            ImGui::SetNextItemWidth(-1);
            if (focusProjectPath)
            {
                ImGui::SetKeyboardFocusHere();
                focusProjectPath = false;
            }
            ImGui::InputText("##ProjectPath", projectPath, sizeof(projectPath));
            if (ImGui::Button(editor::language::text("Open", "打开")))
                action([this] { open(); });
            ImGui::SameLine();
            if (ImGui::Button(editor::language::text("Save", "保存")))
                action([this] { save(); });
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            editor::theme::heading(editor::language::text("Resources", "资源"));
            ImGui::TextDisabled("%s", editor::language::text("Model path", "模型路径"));
            ImGui::SetNextItemWidth(-1);
            if (focusModelPath)
            {
                ImGui::SetKeyboardFocusHere();
                focusModelPath = false;
            }
            ImGui::InputText("##ModelPath", modelPath, sizeof(modelPath));
            if (ImGui::Button(editor::language::text("Import model", "导入模型")))
                action([this] { importModel(); });
            if (ImGui::Button(assetsOpen ? editor::language::text("Hide assets", "收起资源库") : editor::language::text("Show assets", "展开资源库")))
                assetsOpen = !assetsOpen;
            ImGui::Spacing();
            ImGui::TextWrapped("%s", recoveryStatus.c_str());
            if (!recoveries.empty() && ImGui::Button(editor::language::text("Recovery copies...", "恢复副本…")))
                recoveryDismissed = false;
        }
        else
        {
            int languageIndex = editor::language::chinese ? 1 : 0;
            if (ImGui::Combo(editor::language::text("Language###Language", "语言###Language"),
                             &languageIndex, "English\0简体中文\0"))
                editor::language::set(languageIndex == 1);
            editor::theme::heading(editor::language::text("View", "视图"));
            ImGui::Checkbox(editor::language::text("Asset drawer", "资源库抽屉"), &assetsOpen);
            ImGui::Checkbox(editor::language::text("Grid snap", "网格吸附"), &tools.gridSnap);
            ImGui::Checkbox(editor::language::text("Move snap (Shift to toggle)", "移动吸附（Shift 临时切换）"), &tools.moveSnap);
            // Existing controls remain in the viewport too.
            bool lighting = lit;
            if (ImGui::Checkbox(editor::language::text("Studio lighting", "摄影棚光照"), &lighting))
            {
                lit = lighting;
                queueLighting();
            }
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();
            editor::theme::heading(editor::language::text("Shortcuts", "快捷键"));
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
#ifndef NOVA_EDITOR_WINDOW_HOST_CONTROLS
        nativeHandle      = static_cast<GLFWwindow*>(ImGui::GetMainViewport()->PlatformHandle);
#endif
        auto        d     = ImGui::GetIO().DisplaySize;
        const float right = std::clamp(d.x * .26f, 295.f, 400.f), left = 0, top = ImGui::GetFrameHeight();
        const float center = std::max(1.f, d.x - right), bottom = (assetsOpen ? 145.f : 30.f) + 25.f;
        const float sideTop = top + 35, sideHeight = std::max(1.f, d.y - sideTop - 25);
        scenePanelHeight = std::clamp(scenePanelHeight, 140.f, std::max(140.f, sideHeight * .55f));
        if (showGLBExport)
        {
            meshExportFormat = 0;
            ImGui::OpenPopup("Export model");
            showGLBExport = false;
        }
        if (ImGui::BeginPopupModal("Export model", nullptr, ImGuiWindowFlags_AlwaysAutoResize))
        {
            int scope = exportSelectionOnly && !selections.empty() ? 1 : 0;
            ImGui::Combo("Scope", &scope, "Entire scene\0Selected objects\0");
            exportSelectionOnly = scope == 1 && !selections.empty();
            ImGui::Combo("Format", &meshExportFormat, "GLB\0OBJ\0STL\0glTF\0FBX\0");
#ifndef NOVA_EDITOR_WINDOW_HOST_CONTROLS
            ImGui::InputText("Output path", glbExportPath, sizeof(glbExportPath));
#endif
            if (meshExportFormat == 1 || meshExportFormat == 3)
                ImGui::TextDisabled("%s", editor::language::text("The model and its resources are saved in a folder.", "模型及资源将保存到一个文件夹。"));
            if (ImGui::Button(editor::language::text("Export…", "导出…")))
            {
                const auto format = meshExportFormat;
                auto selection = exportSelectionOnly ? std::optional(selections) : std::nullopt;
#ifdef NOVA_EDITOR_WINDOW_HOST_CONTROLS
                static const SDL_DialogFileFilter formats[]{{"GLB model", "glb"}, {"OBJ bundle", "obj"}, {"STL model", "stl"},
                  {"glTF resources", "gltf"}, {"FBX model", "fbx"}};
                chooseFile(formats[format], true, [this, format, selection](const std::string& path) {
                    exportModel(path, format, selection);
                });
#else
                action([this, format, selection, path = std::string(glbExportPath)] { exportModel(path, format, selection); });
#endif
                ImGui::CloseCurrentPopup();
            }
            ImGui::SameLine();
            if (ImGui::Button(editor::language::text("Cancel", "取消"))) ImGui::CloseCurrentPopup();
            ImGui::EndPopup();
        }
        if (ImGui::BeginMainMenuBar())
        {
            ImGui::TextDisabled("NOVA");
            ImGui::BeginDisabled(runtimeScene.has_value());
            if (ImGui::BeginMenu(editor::language::text("File", "文件")))
            {
                if (ImGui::MenuItem(editor::language::text("New project", "新建项目")))
                    action([this] { newProject(); });
                if (ImGui::MenuItem(editor::language::text("Open project...", "打开项目…")))
                {
                    sidebarTab       = 1;
                    focusProjectPath = true;
                }
                if (ImGui::MenuItem(editor::language::text("Save", "保存"), "Ctrl/Cmd S"))
                    action([this] { save(); });
                if (ImGui::MenuItem("Save as..."))
                {
                    sidebarTab       = 1;
                    focusProjectPath = true;
                }
                if (ImGui::MenuItem(editor::language::text("Import…", "导入…")))
                    chooseModelImport();
                if (ImGui::MenuItem(editor::language::text("Export…", "导出…")))
                {
                    exportSelectionOnly = !selections.empty();
                    showGLBExport = true;
                }
                ImGui::EndMenu();
            }
            if (ImGui::BeginMenu(editor::language::text("Edit", "编辑")))
            {
                if (ImGui::MenuItem(editor::language::text("Undo", "撤销"), "Ctrl/Cmd Z", false, !history.past.empty()))
                    action([this] {
                        history.undo();
                        select("");
                    });
                if (ImGui::MenuItem(editor::language::text("Redo", "重做"), "Ctrl/Cmd Shift Z", false, !history.future.empty()))
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
            if (ImGui::BeginMenu(editor::language::text("Add", "添加")))
            {
                if (ImGui::BeginMenu(editor::language::text("Lights", "灯光")))
                {
                    if (ImGui::MenuItem(editor::language::text("Directional light", "方向光")))
                        action([this] { addSceneObject("light"); });
                    if (ImGui::MenuItem(editor::language::text("Point light", "点光")))
                        action([this] { addSceneObject("light", "point"); });
                    if (ImGui::MenuItem(editor::language::text("Spot light", "聚光灯")))
                        action([this] { addSceneObject("light", "spot"); });
                    if (ImGui::MenuItem(editor::language::text("Showcase lighting", "展示灯光")))
                        action([this] { addShowcaseLights(); });
                    if (ImGui::MenuItem(editor::language::text("Rectangle light", "矩形面光")))
                        action([this] { addSceneObject("light", "rectangle"); });
                    ImGui::EndMenu();
                }
                if (ImGui::MenuItem(editor::language::text("Camera", "相机")))
                    action([this] { addSceneObject("camera"); });

                if (ImGui::BeginMenu(editor::language::text("Mesh", "网格")))
                {
                    for (const auto& item : editor::assets::primitives())
                        if (ImGui::MenuItem(item.first.c_str()))
                            action([this, type = item.first] { createPrimitive(type); });
                    ImGui::EndMenu();
                }
                if (ImGui::MenuItem(editor::language::text("Empty node", "空节点")))
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
            if (ImGui::BeginMenu(editor::language::text("View", "视图")))
            {
                if (ImGui::MenuItem(
                      mainPreview ? "Return to editor view" : "Preview main camera",
                      nullptr,
                      false,
                      mainPreview || !editor::primaryCamera(history.scene).empty()))
                    action([this] { toggleMainPreview(); });

                if (ImGui::BeginMenu(editor::language::text("Render mode", "渲染模式"), !tools.drag))
                {
                    for (const auto& [mode, label] : {
                           std::pair{render::RenderMode::Raster, editor::language::text("Raster", "光栅")},
                           std::pair{render::RenderMode::Hybrid, "Hybrid"},
                           std::pair{render::RenderMode::RayTracing, editor::language::text("Ray tracing", "光追")}})
                        if (ImGui::MenuItem(label, nullptr, renderMode == mode))
                            action([this, chosenMode = mode] { setRenderMode(chosenMode); });
                    ImGui::EndMenu();
                }
                if (ImGui::MenuItem("World coordinates", "X", tools.space == editor::TransformSpace::World))
                {
                    tools.cancel(history);
                    tools.space = tools.space == editor::TransformSpace::World ? editor::TransformSpace::Local
                                                                               : editor::TransformSpace::World;
                }
                if (ImGui::MenuItem("Focus selected", "F", false, !tools.drag && !mainPreview))
                    action([this] { frame(selected); });
                if (ImGui::MenuItem(editor::language::text("Frame all", "显示全景"), "Shift F", false, !tools.drag && !mainPreview))
                    action([this] { frame(""); });
                if (ImGui::MenuItem(editor::language::text("Orthographic", "正交"), "P", window->GetCamera().orthographic, !tools.drag && !mainPreview))
                    action([this] {
                        auto c         = window->GetCamera();
                        c.orthographic = !c.orthographic;
                        cameraFocus.reset();
                        window->SetCamera(c);
                    });
                if (ImGui::MenuItem(editor::language::text("Assets", "资源库"), nullptr, assetsOpen))
                    assetsOpen = !assetsOpen;
                if (ImGui::MenuItem("Light settings"))
                {
                    sidebarTab     = 0;
                    lightInspector = true;
                }
                if (ImGui::MenuItem(editor::language::text("Reset view", "恢复默认视角"), nullptr, false, !tools.drag && !mainPreview))
                    action([this] {
                        auto c         = window->GetCamera();
                        c.distance     = 8;
                        c.yaw          = 25;
                        c.pitch        = 20;
                        c.target       = {0, 0, 0};
                        c.orthographic = false;
                        cameraFocus.reset();
                        window->SetCamera(c);
                    });
                ImGui::EndMenu();
            }
            ImGui::EndDisabled();
            ImGui::BeginDisabled(!runtimeScene && (!hasPreviewBehavior() || renderMode != render::RenderMode::Raster));
            if (ImGui::Button(runtimeScene ? editor::language::text("Stop preview", "停止预览") : editor::language::text("Play scene", "播放场景")))
                pending.push_back([this] { toggleScenePreview(); });
            ImGui::EndDisabled();
            ImGui::SameLine(std::max(370.f, d.x - 300));
            ImGui::TextDisabled("%s%s", history.scene["name"].get<std::string>().c_str(), dirty() ? " *" : "");
            ImGui::EndMainMenuBar();
        }
        ImGui::BeginDisabled(runtimeScene.has_value());
        panel("##SidebarTabs", {center, top}, {right, 35}, false);
        if (editor::theme::tool(editor::language::text("Scene", "场景"), sidebarTab == 0))
            sidebarTab = 0;
        ImGui::SameLine();
        if (editor::theme::tool(editor::language::text("Project", "项目"), sidebarTab == 1))
            sidebarTab = 1;
        ImGui::SameLine();
        if (editor::theme::tool(editor::language::text("Settings", "设置"), sidebarTab == 2))
            sidebarTab = 2;
        ImGui::End();
        if (sidebarTab == 0)
        {
            using editor::theme::Icon;
            panel("Scene", {center, sideTop}, {right, scenePanelHeight}, false);
            ImGui::AlignTextToFramePadding();
            editor::theme::heading(editor::language::text("Scene", "场景"));
            ImGui::SameLine(std::max(58.f, right - 111));
            if (editor::theme::iconButton("##AddNode", Icon::Add))
                action([this] { add(); });
            ImGui::SetItemTooltip("%s", editor::language::text("Add empty node", "添加空节点"));
            ImGui::BeginDisabled(selections.empty());
            ImGui::SameLine();
            if (editor::theme::iconButton("##Duplicate", Icon::Duplicate))
                action([this] { treeCommand("duplicate"); });
            ImGui::SetItemTooltip("%s", editor::language::text("Duplicate selected nodes", "复制选中节点"));
            ImGui::SameLine();
            if (editor::theme::iconButton("##Delete", Icon::Delete))
                action([this] { treeCommand("delete"); });
            ImGui::SetItemTooltip("%s", editor::language::text("Delete selected nodes", "删除选中节点"));
            ImGui::EndDisabled();
            ImGui::Separator();
            ImGui::SetNextItemWidth(-1);
            ImGui::InputTextWithHint("##Search", editor::language::text("Search nodes", "搜索节点"), search, sizeof(search));
            if (ImGui::Selectable(editor::language::text("Scene root", "场景根级"), false))
                select("");
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
            editor::theme::heading(editor::language::text("Properties", "属性"));
            ImGui::Separator();
            bool hasSelectedAsset = false;
            for (const auto& node : history.scene["nodes"])
                if (node["id"] == selected && !node.contains("camera") && !node.contains("light"))
                    hasSelectedAsset = true;
            if (!hasSelectedAsset && assetInspectorTab != 3)
                assetInspectorTab = 0;
            if (editor::theme::tool(editor::language::text("Object", "对象"), !lightInspector && assetInspectorTab == 0))
            {
                lightInspector    = false;
                assetInspectorTab = 0;
            }
            if (hasSelectedAsset)
            {
                ImGui::SameLine();
                if (editor::theme::tool(editor::language::text("Geometry", "几何体"), !lightInspector && assetInspectorTab == 1))
                {
                    lightInspector    = false;
                    assetInspectorTab = 1;
                }
                if (ImGui::GetContentRegionAvail().x > 85)
                    ImGui::SameLine();
                if (editor::theme::tool(editor::language::text("Material", "材质"), !lightInspector && assetInspectorTab == 2))
                {
                    lightInspector    = false;
                    assetInspectorTab = 2;
                }
            }
            if (ImGui::GetContentRegionAvail().x > 70)
                ImGui::SameLine();
            if (editor::theme::tool(editor::language::text("Light", "灯光"), lightInspector))
            {
                lightInspector    = true;
                assetInspectorTab = 0;
            }
            if (ImGui::GetContentRegionAvail().x > 75)
                ImGui::SameLine();
            if (editor::theme::tool(editor::language::text("World", "世界"), !lightInspector && assetInspectorTab == 3))
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
                              s["schemaVersion"] = std::max(4, s["schemaVersion"].template get<int>());
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
                              s["schemaVersion"]           = std::max(4, s["schemaVersion"].template get<int>());
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
                    drawAnimation(n);
                    ImGui::BeginDisabled(locked);
                    drawBehavior(n);
                    if (n.contains("camera") || n.contains("light"))
                        drawSceneNodeProperties(n);
                    editor::theme::heading(n.contains("assetId") ? editor::language::text("Model instance", "模型实例") : "Node");
                    ImGui::Spacing();
                    ImGui::TextDisabled("%s", editor::language::text("Name", "名称"));
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
                        auto& asset = history.scene["assets"].at(id);
                        const auto root = assetRoot.empty() ? projectRoot() : assetRoot;
                        const auto path = resolveAsset(root, asset.at("path").get<std::string>());
                        if (path != variantListPath)
                        {
                            variantListPath = path;
                            variantNames.clear();
                            try
                            {
                                const auto doc = selectedAsset(selected);
                                const auto root = doc.json.value("extensions", editor::Json::object());
                                if (root.contains("KHR_materials_variants"))
                                    for (const auto& variant : root["KHR_materials_variants"].value("variants", editor::Json::array()))
                                        variantNames.push_back(variant.value("name", std::string("Variant")));
                            }
                            catch (const std::exception&) {}
                        }
                        if (!variantNames.empty())
                        {
                            const auto current = asset.value("materialVariant", int64_t(-1));
                            const char* label = current >= 0 && size_t(current) < variantNames.size()
                              ? variantNames[size_t(current)].c_str() : "Default material";
                            if (ImGui::BeginCombo("Material variant", label))
                            {
                                auto pick = [&](int index) {
                                    action([this, id, nodeId = selected, index] {
                                        change([&](auto& draft) {
                                            editor::assertEditable(draft, {nodeId});
                                            if (index < 0)
                                                draft["assets"][id].erase("materialVariant");
                                            else
                                                draft["assets"][id]["materialVariant"] = index;
                                        });
                                    });
                                };
                                if (ImGui::Selectable("Default material", current < 0)) pick(-1);
                                for (size_t i = 0; i < variantNames.size(); ++i)
                                {
                                    ImGui::PushID(int(i));
                                    if (ImGui::Selectable(variantNames[i].c_str(), current == int(i))) pick(int(i));
                                    ImGui::PopID();
                                }
                                ImGui::EndCombo();
                            }
                        }
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
                    editor::theme::heading(editor::language::text("Transform", "变换"));
                    ImGui::Spacing();
                    try
                    {
                        const auto inspected = editor::readNodeTransform(history.scene, selected, tools.space);
                        for (const auto* key : {"position", "scale"})
                        {
                            float v[3];
                            for (int i = 0; i < 3; i++)
                                v[i] = inspected[key][i];
                            if (editor::theme::vector(std::string(key) == "position" ? editor::language::text("Position", "位置") : editor::language::text("Scale", "缩放"), key, v))
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
                        if (editor::theme::vector(editor::language::text("Rotation °", "旋转 °"), "rotation", angles.data(), "%.1f"))
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
                    if (ImGui::Button(editor::language::text("Drop to surface", "一键落地"), {-1, 29}))
                        action([this] { landSelected(); });
                    if (ImGui::Button("Duplicate selection", {-1, 29}))
                        action([this] { treeCommand("duplicate"); });
                    if (ImGui::Button("Delete selection", {-1, 29}))
                        action([this] { treeCommand("delete"); });
                    ImGui::EndDisabled();
                    break;
                }
                if (!found)
                    ImGui::TextWrapped("%s", editor::language::text("Select an object.", "选择一个场景对象。"));
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
        if (ImGui::Button(assetsOpen ? editor::language::text("- Assets", "− 资源库") : editor::language::text("+ Assets", "＋ 资源库")))
            assetsOpen = !assetsOpen;
        ImGui::SameLine();
        ImGui::TextDisabled("%zu", history.scene["assets"].size());
        ImGui::SameLine();
        if (ImGui::SmallButton(editor::language::text("+ Import model", "＋ 导入模型")))
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
                ImGui::BeginChild("##AssetFiles", {0, 96}, ImGuiChildFlags_None, ImGuiWindowFlags_HorizontalScrollbar);
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
                    painter->AddRectFilled(p, {p.x + 104, p.y + 63}, ImGui::GetColorU32(ImGuiCol_FrameBg), 5);
                    painter->AddRect(p, {p.x + 104, p.y + 63}, active ? IM_COL32(123, 182, 238, 255) : ImGui::GetColorU32(ImGuiCol_Border), 4);
                    if (ImGui::Selectable("##Asset", active, ImGuiSelectableFlags_None, {104, 82}) && !nodeId.empty())
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
                    if (ImGui::IsRectVisible(p, {p.x + 104, p.y + 84}))
                    {
                        const auto resource = resolveAsset(assetRoot.empty() ? projectRoot() : assetRoot,
                                                           it.value()["path"].get<std::string>());
                        const auto* preview = assetPreviews.request(resource);
                        if (!preview || preview->empty())
                            editor::theme::cube(painter, {p.x + 52, p.y + 31}, ImGui::GetColorU32(ImGuiCol_CheckMark));
                        else
                        {
                            painter->AddRectFilledMultiColor({p.x + 1, p.y + 1}, {p.x + 103, p.y + 62},
                                IM_COL32(53, 54, 56, 255), IM_COL32(53, 54, 56, 255),
                                IM_COL32(33, 34, 36, 255), IM_COL32(33, 34, 36, 255));
                            constexpr float dx = 102.f / editor::assets::previewWidth;
                            constexpr float dy = 61.f / editor::assets::previewHeight;
                            for (const auto& run : *preview)
                                painter->AddRectFilled({p.x + 1 + run.x * dx, p.y + 1 + run.y * dy},
                                    {p.x + 1 + (run.x + run.length) * dx, p.y + 1 + (run.y + 1) * dy}, run.color);
                        }
                        if (active)
                            painter->AddRect(p, {p.x + 104, p.y + 63}, IM_COL32(123, 182, 238, 255), 4);
                    }
                    painter->PushClipRect({p.x + 3, p.y + 63}, {p.x + 101, p.y + 84}, true);
                    const float textWidth = ImGui::CalcTextSize(label.c_str()).x;
                    painter->AddText({p.x + std::max(4.f, (104 - textWidth) / 2), p.y + 66},
                                     ImGui::GetColorU32(ImGuiCol_Text), label.c_str());
                    painter->PopClipRect();
                    ImGui::PopID();
                }
                if (!index)
                    ImGui::TextDisabled("%s", editor::language::text("Import a model to start your asset library.", "导入模型开始建立资源库。"));
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
        const char* stats = editorClockSeconds() - lastRenderedFrame < .75 ? frameStatsLabel : "Idle";
        const auto statsSize = ImGui::CalcTextSize(stats);
        if (viewportRect[2] >= statsSize.x + 24 && viewportRect[3] >= statsSize.y + 18)
        {
            auto* draw = ImGui::GetBackgroundDrawList();
            const ImVec2 max{viewportRect[0] + viewportRect[2] - 10, viewportRect[1] + viewportRect[3] - 10};
            const ImVec2 min{max.x - statsSize.x - 16, max.y - statsSize.y - 8};
            draw->AddRectFilled(min, max, IM_COL32(27, 29, 33, 220), 4);
            draw->AddText({min.x + 8, min.y + 4}, IM_COL32(241, 243, 246, 255), stats);
        }
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
        if (!runtimeScene) tools.draw(
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
          [this](editor::OrbitCamera camera) { action([this, camera] { cameraFocus.reset(); window->SetCamera(camera); }); });
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, {5, 4});
        panel("##ViewportOptions", {189, top + 6}, {46, 34}, false);
        ImGui::BeginDisabled(tools.drag.has_value());
        if (editor::theme::iconButton("##ViewportSettings", editor::theme::Icon::Settings))
            ImGui::OpenPopup(editor::language::text("Viewport settings", "视口设置"));
        ImGui::SetItemTooltip("%s", editor::language::text("Viewport settings", "视口设置"));
        if (ImGui::BeginPopup(editor::language::text("Viewport settings", "视口设置")))
        {
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
                    cameraFocus.reset();
                    window->SetCamera(c);
                });
            int modeIndex = static_cast<int>(renderMode);
            ImGui::SetNextItemWidth(128);
            if (ImGui::Combo("##RenderMode", &modeIndex, "Raster\0Ray tracing\0Hybrid\0"))
                action([this, modeIndex] { setRenderMode(static_cast<render::RenderMode>(modeIndex)); });
            if (renderMode == render::RenderMode::RayTracing)
            {
                int integrator = int(window->GetRayTracing().integrator);
                ImGui::SetNextItemWidth(120);
                if (ImGui::Combo("##RayIntegrator", &integrator, "PT\0BDPT\0Photon mapping\0"))
                    action([this, integrator] { setIntegrator(render::PathIntegrator(integrator)); });
                }
            ImGui::BeginDisabled(renderMode == render::RenderMode::RayTracing);
            if (ImGui::Button(renderMode == render::RenderMode::RayTracing ? "PBR" : lit ? "Lit" : "Unlit"))
            {
                lit = !lit;
                queueLighting();
            }
            ImGui::EndDisabled();
            if (ImGui::Button(editor::language::text("Lighting settings", "光照设置")))
            {
                sidebarTab = 0;
                lightInspector = true;
                ImGui::CloseCurrentPopup();
            }
            ImGui::Separator();
            ImGui::Checkbox(editor::language::text("Grid snap", "网格吸附"), &tools.gridSnap);
            ImGui::Checkbox(editor::language::text("Move snap (Shift to toggle)", "移动吸附（Shift 临时切换）"), &tools.moveSnap);
            ImGui::SetNextItemWidth(128);
            ImGui::Combo("##PlacementStep", &tools.gridIndex, "0.1 m\0" "0.25 m\0" "0.5 m\0" "1 m\0" "2 m\0" "5 m\0");
            ImGui::EndPopup();
        }
        ImGui::EndDisabled();
        ImGui::End();
        ImGui::PopStyleVar();
        ImGui::EndDisabled();
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
               it.value().value("sourceSpace", false),
               it.value().contains("materialVariant")
                   ? std::optional<uint32_t>(it.value()["materialVariant"].get<uint32_t>()) : std::nullopt});
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
        const auto proceduralGrid = window->GetViewportGrid().enabled;
        for (const auto& helper : helpers)
        {
            if (proceduralGrid && helper["name"] == "grid")
                continue;
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
        try
        {
            window->SetScene(assets, instances);
        }
        catch (const std::invalid_argument& error)
        {
            if (renderMode == render::RenderMode::Raster || std::string_view(error.what()) != "Animated scenes require Raster mode")
                throw;
            setRenderMode(render::RenderMode::Raster);
            window->SetScene(assets, instances);
        }
        assetBounds.clear();
        for (auto it = history.scene["assets"].begin(); it != history.scene["assets"].end(); ++it)
            if (auto b = window->GetSceneAssetBounds(it.key()))
                assetBounds[it.key()] = {
                  {b->minimum[0], b->minimum[1], b->minimum[2]}, {b->maximum[0], b->maximum[1], b->maximum[2]}};
        if (!pendingFocus.empty())
        {
            auto id = pendingFocus;
            pendingFocus.clear();
            frame(id == "*" ? "" : id, id != "*");
        }
        previewAssets = std::move(assets);
        authoredInstances = std::move(instances);
        previewInstanceCount = userCount;
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
    void frame(const std::string& id, bool ease = true)
    {
        cameraFocus.reset();
        auto           c      = window->GetCamera();
        editor::Camera camera = editor::navigationCamera(c);
        auto           box    = editor::sceneBounds(history.scene, assetBounds, id);
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
        auto next = editor::frameBounds(camera, box, {viewportRect[2], viewportRect[3]});
        auto destination = c;
        destination.distance = float(next.distance);
        for (int k = 0; k < 3; ++k)
            destination.target[k] = float(next.target[k]);
        if (ease && (c.distance != destination.distance || c.target != destination.target))
            cameraFocus = CameraFocus{c, destination, editorClockSeconds()};
        else
            window->SetCamera(destination);
    }

    void advanceCameraFocus(double now)
    {
        if (!cameraFocus) return;
        const auto& focus = *cameraFocus;
        const auto elapsed = std::clamp((now - focus.started) / .28, 0., 1.);
        const auto eased = float(elapsed * elapsed * (3 - 2 * elapsed));
        auto camera = focus.to;
        if (elapsed < 1.)
        {
            camera.distance = focus.from.distance + (camera.distance - focus.from.distance) * eased;
            for (size_t axis = 0; axis < camera.target.size(); ++axis)
                camera.target[axis] = focus.from.target[axis] + (camera.target[axis] - focus.from.target[axis]) * eased;
        }
        window->SetCamera(camera);
        if (elapsed == 1.) cameraFocus.reset();
    }

    void flush()
    {
#ifdef NOVA_EDITOR_WINDOW_HOST_CONTROLS
        finishFileChoice();
#endif
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
        render::GraphicsAPI api = render::GraphicsAPI::Auto;
        editor::language::load(editor::defaultRecoveryRoot().parent_path() / "language");
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
            if (arg == "--api" && i + 1 < argc)
            {
                const std::string name = argv[++i];
                if (name == "auto")
                    api = render::GraphicsAPI::Auto;
                else if (name == "metal")
                    api = render::GraphicsAPI::Metal;
                else if (name == "vulkan")
                    api = render::GraphicsAPI::Vulkan;
                else if (name == "dx12")
                    api = render::GraphicsAPI::D3D12;
                else
                    throw std::runtime_error("Unknown graphics API: " + name);
            }
            else if (arg == "--frames" && i + 1 < argc)
                limit = std::stoi(argv[++i]);
            else if (arg == "--model" && i + 1 < argc)
                model = argv[++i];
            else if (arg == "--recovery-dir" && i + 1 < argc)
                editor.recoveryBase = std::filesystem::absolute(argv[++i]);
            else if (arg == "--project" && i + 1 < argc)
                std::snprintf(editor.projectPath, sizeof(editor.projectPath), "%s", argv[++i]);
            else
                throw std::runtime_error(
                  "Usage: nova_editor [--api auto|metal|vulkan|dx12] [--frames N] [--model file.gltf|file.glb] [--project "
                  "project.json] [--recovery-dir "
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
        config.renderer.api = api;
        editor::RenderWindow window(config);
        editor.window = &window;
        window.SetAntiAliasing({render::AAMethod::SMAA});
        if (window.GetRasterCapabilities().deferred)
        {
            render::ViewportGridSettings grid;
            grid.enabled = true;
            grid.elevation = -.012f;
            grid.majorSpacing = 5.f;
            window.SetViewportGrid(grid);
        }
        window.SetClearColor({.6f, .6f, .6f, 1});
        window.SetLighting(render::LightingMode::PBR);
        window.SetDirectionalLight(editor.studio.light());
        window.SetShadows({editor.studio.shadows, editor.studio.softness, 2});
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
        double lastFrame = editorClockSeconds();
        while (!limit || frames < limit)
        {
            if (!window.PollEvents() && !editor.continueAfterClose(window))
                break;
            if (editor.exitApproved)
                break;
            const double now = editorClockSeconds();
            const auto delta = static_cast<float>(std::clamp(now - lastFrame, 0.0, 0.1));
            editor.advanceCameraFocus(now);
            editor.advanceScenePreview(delta);
            editor.advanceAnimations(delta);
            editor.syncOutlines();
            lastFrame = now;
            if (window.DrawFrame() == render::FrameResult::Rendered)
            {
                ++frames;
                editor.recordViewportFrame(editorClockSeconds());
            }
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
