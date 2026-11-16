#include "../apps/desktop/src/RenderBridge.hpp"
#include <cmath>
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
        cfg.title  = "Source units and viewport regression";
        editor::RenderWindow         window(cfg);
        render::ParameterPanelConfig ui;
        ui.showBuiltinPanel = false;
        ui.sceneViewport    = [] { return std::array<float, 4>{140, 100, 620, 480}; };
        window.EnableParameterPanel(ui);
        std::vector<render::SceneAsset> assets{
          {"small", root / "units-small.glb", true}, {"tall", root / "units-tall.glb", true}};
        std::vector<render::SceneInstance> instances{{"small", "small"}, {"tall", "tall"}};
        instances[1].world[12] = 4;
        window.SetScene(assets, instances);
        auto close = [](float a, float b) {
            if (std::abs(a - b) > .0001f)
                throw std::runtime_error("Source model bounds mismatch");
        };
        auto small = window.GetSceneAssetBounds("small"), tall = window.GetSceneAssetBounds("tall");
        if (!small || !tall)
            throw std::runtime_error("Asset bounds missing");
        close(small->minimum[0], .25);
        close(small->maximum[0], 1.25);
        close(small->minimum[1], 0);
        close(tall->maximum[1], 3);
        close(tall->maximum[0] - tall->minimum[0], 2);
        auto ray = render::Ray{{1.2f, .5f, 4}, {0, 0, -1}};
        auto hit = window.PickScene(ray);
        if (!hit || hit->id != "small")
            throw std::runtime_error("Source-space triangle picking failed");
        auto c     = window.GetCamera();
        c.target   = {2, 1, 0};
        c.distance = 9;
        c.yaw      = 25;
        c.pitch    = 20;
        window.SetClearColor({.6, .6, .6, 1});
        int frames = 0;
        while (window.PollEvents() && frames < 120)
        {
            c.orthographic = frames >= 60;
            c.target[0]    = 2 + std::sin(frames * .02f) * .2f;
            window.SetCamera(c);
            if (window.DrawFrame() == render::FrameResult::Rendered)
                frames++;
        }
        assets[0].sourceSpace = false;
        window.SetScene(assets, instances);
        if (window.PickScene(ray))
            throw std::runtime_error("Legacy normalized bounds changed");
        small = window.GetSceneAssetBounds("small");
        close(small->minimum[0], -1);
        close(small->maximum[0], 1);
        window.DrawFrame();
        window.WaitIdle();
        if (frames != 120 || window.ValidationErrorCount())
            throw std::runtime_error("Source units GPU regression failed");
        std::cout << "Source dimensions/origin, legacy compatibility, picking, target pan, orthographic and viewport: "
                     "120 frames, validation errors: 0\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
