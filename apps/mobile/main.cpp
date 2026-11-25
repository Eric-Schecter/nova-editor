#include "Platform.hpp"
#include "Gizmo.hpp"
#include "Persistence.hpp"
#include "Lighting.hpp"
#include "ReferenceGrid.hpp"

#include <SDL3/SDL.h>
#include <SDL3/SDL_main.h>
#include <render/Window.hpp>

#include <cstring>
#include <deque>
#include <mutex>

namespace
{
    struct Command
    {
        Action action;
        std::filesystem::path path;
        std::string label;
    };

    std::mutex commandsMutex;
    std::deque<Command> commands;

    struct Touch
    {
        std::mutex mutex;
        std::optional<SDL_FingerID> finger;
        editor::Screen start;
        std::optional<editor::Screen> tap;
        bool moved = false;

        static bool SDLCALL watch(void* state, SDL_Event* event)
        {
            auto& touch = *static_cast<Touch*>(state);
            if (event->type < SDL_EVENT_FINGER_DOWN || event->type > SDL_EVENT_FINGER_CANCELED)
                return true;
            std::lock_guard lock(touch.mutex);
            switch (event->type)
            {
            case SDL_EVENT_FINGER_DOWN:
                if (touch.finger)
                    touch.moved = true;
                else
                {
                    touch.finger = event->tfinger.fingerID;
                    touch.start = {event->tfinger.x, event->tfinger.y};
                    touch.moved = false;
                }
                break;
            case SDL_EVENT_FINGER_MOTION:
                if (touch.finger == event->tfinger.fingerID &&
                    std::hypot(event->tfinger.x - touch.start.x, event->tfinger.y - touch.start.y) > .015)
                    touch.moved = true;
                break;
            case SDL_EVENT_FINGER_UP:
            case SDL_EVENT_FINGER_CANCELED:
                if (touch.finger == event->tfinger.fingerID)
                {
                    if (!touch.moved && event->type == SDL_EVENT_FINGER_UP)
                        touch.tap = {event->tfinger.x, event->tfinger.y};
                    touch.finger.reset();
                }
                break;
            }
            return true;
        }

        Touch()
        {
            if (!SDL_AddEventWatch(watch, this))
                throw std::runtime_error(SDL_GetError());
        }
        ~Touch() { SDL_RemoveEventWatch(watch, this); }

        std::optional<editor::Screen> takeTap()
        {
            std::lock_guard lock(mutex);
            return std::exchange(tap, std::nullopt);
        }
    };

    void validateGLB(const std::filesystem::path& path)
    {
        std::ifstream input(path, std::ios::binary);
        std::array<unsigned char, 12> header{};
        input.read(reinterpret_cast<char*>(header.data()), header.size());
        uint32_t length = uint32_t(header[8]) | (uint32_t(header[9]) << 8) |
                          (uint32_t(header[10]) << 16) | (uint32_t(header[11]) << 24);
        if (!input || std::memcmp(header.data(), "glTF\2\0\0\0", 8) ||
            length != std::filesystem::file_size(path))
            throw std::runtime_error("Choose a valid GLB 2.0 model");
    }

    class Project
    {
      public:
        Project(render::Window& window, std::filesystem::path root)
            : window(window), root(std::move(root))
        {
            std::filesystem::create_directories(this->root / "assets");
            mobile::writeReferenceGrid(this->root / "reference-grid.glb");
            window.SetLighting(render::LightingMode::PBR);
            window.SetDirectionalLight(editor::StudioSettings{}.light());
            window.SetClearColor({.6f, .6f, .6f, 1.f});
            window.SetScene({gridAsset()}, {gridInstance()});
        }

        void run(const Command& command)
        {
            switch (command.action)
            {
            case Action::Import:
                import(command.path, command.label);
                break;
            case Action::Save:
                if (scene["nodes"].empty())
                    throw std::runtime_error("Import a GLB before saving");
                editor::verifyAssets(scene, root);
                editor::save(root / "project.json", scene);
                pruneAssets();
                showStatus("Saved " + name());
                break;
            case Action::Open:
                apply(editor::read(root / "project.json"));
                showStatus("Opened " + name());
                break;
            case Action::Select:
                if (!scene["nodes"].empty())
                    select(true);
                break;
            }
        }

        void resize(const std::array<uint32_t, 2>& pixels)
        {
            if (!pixels[0] || !pixels[1] || pixels == framebuffer)
                return;
            framebuffer = pixels;
            const double aspect = double(pixels[0]) / pixels[1];
            camera.distance = std::max(4.3, 3.2 / aspect);
            render::OrbitCamera view;
            view.yaw = float(camera.yaw);
            view.pitch = float(camera.pitch);
            view.distance = float(camera.distance);
            window.SetCamera(view);
        }

        void pick(editor::Screen position)
        {
            const editor::Size size{double(framebuffer[0]), double(framebuffer[1])};
            const auto ray = editor::rayAt({position.x * size.width, position.y * size.height}, camera, size);
            render::Ray query;
            for (size_t axis = 0; axis < 3; ++axis)
            {
                query.origin[axis] = float(ray.origin[axis]);
                query.direction[axis] = float(ray.direction[axis]);
            }
            query.includeIds = {"model"};
            select(window.PickScene(query).has_value());
        }

      private:
        render::Window& window;
        std::filesystem::path root;
        editor::Json scene = editor::emptyScene();
        editor::Camera camera{20, 8, 4.3};
        std::array<uint32_t, 2> framebuffer{};

        void select(bool selected)
        {
            showModel(scene["nodes"].empty() ? "" : name(), selected);
            showStatus(selected ? "Selected " + name() : "No selection");
        }

        render::SceneAsset gridAsset() const { return {"editor-grid", root / "reference-grid.glb", true, {}}; }

        static render::SceneInstance gridInstance()
        {
            render::SceneInstance grid{"editor-grid", "editor-grid"};
            grid.castShadow = false;
            return grid;
        }

        std::string name() const { return scene.at("name").get<std::string>(); }

        void apply(editor::Json next)
        {
            editor::verifyAssets(next, root);
            const auto& node = next.at("nodes").at(0);
            const auto id = node.at("assetId").get<std::string>();
            const auto path = editor::safeAssetPath(root, next.at("assets").at(id).at("path").get<std::string>());
            validateGLB(path);
            window.SetScene({gridAsset(), {id, path, false, {}}}, {gridInstance(), {node.at("id").get<std::string>(), id}});
            scene = std::move(next);
            showModel(name(), false);
        }

        void pruneAssets()
        {
            const auto retained = scene.at("assets").at("model").at("path").get<std::string>();
            std::error_code error;
            for (const auto& entry : std::filesystem::directory_iterator(root / "assets"))
                if (entry.path().extension() == ".glb" && entry.path().lexically_relative(root) != retained)
                    std::filesystem::remove(entry.path(), error);
        }

        void import(const std::filesystem::path& source, const std::string& label)
        {
            validateGLB(source);
            auto relative = "assets/" + source.stem().string() + "-" + std::to_string(SDL_GetTicksNS()) + ".glb";
            // The platform creates a private, uniquely named staging file.
            std::filesystem::rename(source, root / relative);
            try
            {
                auto next = editor::emptyScene();
                next["name"] = label;
                next["assets"]["model"] = {{"name", label}, {"path", relative}};
                next["nodes"].push_back({{"id", "model"}, {"name", label}, {"parentId", nullptr},
                                         {"assetId", "model"}, {"transform", editor::identity()}});
                apply(std::move(next));
            }
            catch (...)
            {
                std::error_code ignored;
                std::filesystem::remove(root / relative, ignored);
                throw;
            }
            showStatus("Imported " + name());
        }
    };
}

void enqueue(Action action, std::filesystem::path path, std::string label)
{
    std::lock_guard lock(commandsMutex);
    commands.push_back({action, std::move(path), std::move(label)});
}

int main(int, char**)
{
    try
    {
        render::WindowConfig config;
        config.title = "Nova Editor";
        render::Window window(config);
        const std::unique_ptr<char, decltype(&SDL_free)> path(SDL_GetPrefPath("Nova", "Editor"), SDL_free);
        if (!path)
            throw std::runtime_error(SDL_GetError());
        Project project(window, std::filesystem::path(path.get()) / "scene");
        Touch touch;
        installControls();
        showStatus("Import a GLB to start");
        while (window.PollEvents())
        {
            std::deque<Command> pending;
            {
                std::lock_guard lock(commandsMutex);
                commands.swap(pending);
            }
            for (const auto& command : pending)
            {
                try { project.run(command); }
                catch (const std::exception& error) { showStatus(error.what()); }
                if (command.action == Action::Import)
                {
                    std::error_code ignored;
                    std::filesystem::remove(command.path, ignored);
                }
            }
            const auto pixels = window.GetFramebufferSize();
            project.resize(pixels);
            if (window.DrawFrame() == render::FrameResult::Rendered && pixels[0] && pixels[1])
                if (auto tap = touch.takeTap())
                    project.pick(*tap);
        }
        window.WaitIdle();
        return 0;
    }
    catch (const std::exception& error)
    {
        SDL_LogError(SDL_LOG_CATEGORY_APPLICATION, "%s", error.what());
        return 1;
    }
}
