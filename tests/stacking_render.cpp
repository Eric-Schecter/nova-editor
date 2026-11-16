#include "../apps/desktop/src/RenderBridge.hpp"
#include "Lighting.hpp"
#include "Placement.hpp"
#include <iostream>
#include <render/Window.hpp>
int main(int argc, char** argv)
{
    try
    {
        if (argc != 2)
            throw std::runtime_error("fixtures directory required");
        auto                 root = std::filesystem::path(argv[1]);
        render::WindowConfig cfg;
        cfg.width  = 1000;
        cfg.height = 740;
        cfg.title  = "Surface stacking regression";
        editor::RenderWindow window(cfg);
        editor::Json   scene = {{"nodes", editor::Json::array()}};
        auto           base = editor::identity(), moving = editor::identity();
        moving["position"] = {-.75, 8, -.5};
        scene["nodes"].push_back({{"id", "base"}, {"parentId", nullptr}, {"assetId", "tall"}, {"transform", base}});
        scene["nodes"].push_back(
          {{"id", "moving"}, {"parentId", nullptr}, {"assetId", "small"}, {"transform", moving}});
        std::vector<render::SceneAsset> defs{
          {"small", root / "units-small.glb", true}, {"tall", root / "units-tall.glb", true}};
        auto sync = [&] {
            auto                               worlds = editor::worldMatrices(scene);
            std::vector<render::SceneInstance> instances;
            for (const auto& n : scene["nodes"])
                instances.push_back({n["id"], n["assetId"], worlds.at(n["id"].get<std::string>())});
            window.SetScene(defs, instances);
        };
        sync();
        editor::AssetBounds bounds;
        for (auto id : {"small", "tall"})
        {
            auto b = window.GetSceneAssetBounds(id);
            if (!b)
                throw std::runtime_error("Missing bounds");
            bounds[id] = {{b->minimum[0], b->minimum[1], b->minimum[2]}, {b->maximum[0], b->maximum[1], b->maximum[2]}};
        }
        auto query = editor::surfaceQuery(
          scene,
          [&](editor::Ray ray, const std::set<std::string>& included, const std::set<std::string>& excluded)
            -> std::optional<editor::SurfaceHit> {
              render::Ray r;
              for (int k = 0; k < 3; k++)
              {
                  r.origin[k]    = float(ray.origin[k]);
                  r.direction[k] = float(ray.direction[k]);
              }
              r.includeIds.assign(included.begin(), included.end());
              r.excludeIds.assign(excluded.begin(), excluded.end());
              auto h = window.PickScene(r);
              if (!h)
                  return {};
              return editor::SurfaceHit{h->id, {h->position[0], h->position[1], h->position[2]}};
          });
        auto close = [](double a, double b) {
            if (std::abs(a - b) > .0001)
                throw std::runtime_error("Stacking height mismatch: " + std::to_string(a) + " != " + std::to_string(b));
        };
        auto t = editor::groundedTransform(scene, "moving", bounds, query);
        if (!t)
            throw std::runtime_error("Ground failed");
        close((*t)["position"][1], 3);
        scene["nodes"][1]["transform"] = *t;
        sync();
        close((*editor::groundedTransform(scene, "moving", bounds, query))["position"][1], 3);
        for (bool ortho : {false, true})
        {
            editor::Camera c{25, 45, 12, ortho, {0, 2, 0}};
            editor::Size   size{1000, 740};
            auto           p = editor::project({0, 4, 0}, c, size);
            auto placed      = editor::placementAt(*p, c, size, bounds.at("small"), false, 1, &scene, &bounds, query);
            if (!placed)
                throw std::runtime_error("Surface placement failed");
            close((*placed)["position"][1], 4);
        }
        auto camera     = window.GetCamera();
        camera.target   = {0, 2, 0};
        camera.distance = 10;
        camera.pitch    = 25;
        window.SetCamera(camera);
        window.SetLighting(render::LightingMode::PBR);
        bool rejected = false;
        try
        {
            window.SetShadows({true, -1});
        }
        catch (const std::invalid_argument&)
        {
            rejected = true;
        }
        if (!rejected)
            throw std::runtime_error("Invalid softness accepted");
        editor::StudioSettings lighting;
        int                    frames = 0;
        while (window.PollEvents() && frames < 120)
        {
            lighting.azimuth   = frames < 40 ? -26.565f : 40.f;
            lighting.elevation = frames < 40 ? 35.586f : 60.f;
            lighting.color     = frames < 40 ? std::array<float, 3>{1, 1, 1} : std::array<float, 3>{1, .5f, .25f};
            lighting.intensity = frames < 40 ? 3.5f : 5.f;
            window.SetDirectionalLight(lighting.light());
            render::SceneShadowSettings shadows{frames < 80, frames < 40 ? 0.f : 4.f};
            window.SetShadows(shadows);
            auto actual = window.GetShadows();
            if (actual.enabled != shadows.enabled || actual.softness != shadows.softness)
                throw std::runtime_error("Shadow settings roundtrip failed");
            if (window.DrawFrame() == render::FrameResult::Rendered)
                frames++;
        }
        window.WaitIdle();
        if (frames != 120 || window.ValidationErrorCount())
            throw std::runtime_error("Stacking render validation failed");
        std::cout << "Real SDK stacking, adjustable light direction/color/intensity and hard/soft/disabled shadows: "
                     "120 frames, "
                     "validation errors: 0\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
