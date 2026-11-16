#include "../apps/desktop/src/RenderBridge.hpp"
#include <cmath>
#include <iostream>
#include <render/Window.hpp>
int main(int argc, char** argv)
{
    try
    {
        if (argc != 3)
            throw std::runtime_error("Usage: picking_test <triangle.glb> metal|vulkan");
        render::WindowConfig config;
        config.renderer.api =
          std::string(argv[2]) == "metal" ? render::GraphicsAPI::Metal : render::GraphicsAPI::Vulkan;
        editor::RenderWindow               window(config);
        std::vector<render::SceneAsset>    assets{{"mesh", argv[1]}};
        std::vector<render::SceneInstance> instances{{"back", "mesh"}, {"front", "mesh"}};
        instances[0].world[14] = -2;
        window.SetScene(assets, instances);
        auto hit = window.PickScene({{-.25f, -.25f, 3}, {0, 0, -1}});
        if (!hit || hit->id != "front" || std::abs(hit->distance - 3) > .0001)
            throw std::runtime_error("Nearest triangle picking failed");
        if (window.PickScene({{.75f, .75f, 3}, {0, 0, -1}}))
            throw std::runtime_error("Bounding-box false positive");
        instances.resize(1);
        instances[0].id        = "mirror";
        instances[0].world[14] = 0;
        instances[0].world[0]  = -2;
        instances[0].world[5]  = .5;
        window.SetScene(assets, instances);
        hit = window.PickScene({{.5f, -.125f, 3}, {0, 0, -1}});
        if (!hit || hit->id != "mirror")
            throw std::runtime_error("Transformed instance picking failed");
        window.DrawFrame();
        instances[0].world[0] = 0;
        window.SetScene(assets, instances);
        if (window.PickScene({{0, 0, 3}, {0, 0, -1}}))
            throw std::runtime_error("Singular instance picked");
        window.SetScene({}, {});
        if (window.PickScene({{0, 0, 3}, {0, 0, -1}}))
            throw std::runtime_error("Empty scene picked");
        window.DrawFrame();
        window.WaitIdle();
        if (window.ValidationErrorCount())
            throw std::runtime_error("GPU validation error");
        std::cout << "Nearest triangles / bounding-box misses / mirrored nonuniform instances / singular and empty "
                     "picking passed\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
