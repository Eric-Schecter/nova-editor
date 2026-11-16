#include "../apps/desktop/src/RenderBridge.hpp"
#include "Transforms.hpp"
#include <iostream>
#include <render/Window.hpp>
int main(int argc, char** argv)
{
    try
    {
        if (argc != 3)
            throw std::runtime_error("Usage: scene_render_test <assets-dir> metal|vulkan|dx12");
        auto                 root = std::filesystem::path(argv[1]);
        render::WindowConfig config;
        std::string          api = argv[2];
        config.renderer.api      = api == "metal"    ? render::GraphicsAPI::Metal
                                   : api == "vulkan" ? render::GraphicsAPI::Vulkan
                                                     : render::GraphicsAPI::D3D12;
        config.width             = 900;
        config.height            = 700;
        config.title             = "Nova instance regression";
        editor::RenderWindow window(config);
        auto           camera = window.GetCamera();
        camera.distance       = 8;
        window.SetCamera(camera);
        std::vector<render::SceneAsset> assets{
          {"helmet", root / "DamagedHelmet/DamagedHelmet.glb"}, {"avocado", root / "Avocado/Avocado.glb"}};
        std::vector<render::SceneInstance> instances{{"left", "helmet"}, {"right", "helmet"}, {"fruit", "avocado"}};
        int                                frame = 0;
        while (window.PollEvents() && frame < 120)
        {
            camera.pitch        = frame < 30 ? 20.f : frame < 60 ? 90.f : frame < 90 ? -90.f : 0.f;
            camera.orthographic = frame >= 30 && frame < 90;
            window.SetCamera(camera);
            auto a = editor::identity(), b = a, c = a;
            a["position"]      = {-1.5, 0, 0};
            b["position"]      = {1.5, 0, 0};
            c["position"]      = {0, 1.8, 0};
            c["scale"]         = {.6, .6, .6};
            b["rotation"]      = editor::eulerQuaternion({float(frame) * 2, 25.f, 15.f});
            b["scale"]         = {.7, 1.2, .5};
            a["position"][1]   = std::sin(frame * .05f) * .3f;
            instances[0].world = editor::localMatrix(a);
            instances[1].world = editor::localMatrix(b);
            instances[2].world = editor::localMatrix(c);
            if (frame == 30)
                instances.push_back({"extra", "helmet", instances[0].world});
            if (frame == 60)
                instances.resize(3);
            window.SetScene(assets, instances);
            if (window.DrawFrame() == render::FrameResult::Rendered)
                ++frame;
        }
        window.SetScene({}, {});
        window.DrawFrame();
        window.SetScene(assets, instances);
        window.DrawFrame();
        window.LoadModel(assets[0].path);
        window.DrawFrame();
        window.SetScene(assets, instances);
        window.DrawFrame();
        window.WaitIdle();
        if (frame != 120 || window.ValidationErrorCount())
            throw std::runtime_error("Instance regression failed");
        std::cout << "Multi-instance transform/add/remove/clear/legacy transitions passed; validation errors: "
                  << window.ValidationErrorCount() << '\n';
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
