#define NOVA_EDITOR_TEST
#include "../apps/desktop/src/main.cpp"
int main(int argc, char** argv)
{
    try
    {
        if (argc != 3 && argc != 4)
            throw std::runtime_error("Expected project and helper resources");
        auto   project = std::filesystem::absolute(argv[1]);
        Editor e;
        e.helperRoot   = std::filesystem::absolute(argv[2]);
        e.assetRoot    = project.parent_path();
        e.recoveryBase = e.assetRoot / "render-recovery";
        e.history.replace(editor::read(project));
        e.saved = e.history.scene;
        std::snprintf(e.projectPath, sizeof(e.projectPath), "%s", project.string().c_str());
        render::WindowConfig config;
        config.width          = 1440;
        config.height         = 900;
        config.title          = "Nova multi-light editor validation";
        const std::string api = argc == 4 ? argv[3] : "metal";
        if (api != "metal" && api != "vulkan" && api != "dx12")
            throw std::runtime_error("Invalid test API");
        config.renderer.api = api == "vulkan" ? render::GraphicsAPI::Vulkan
                              : api == "dx12" ? render::GraphicsAPI::D3D12
                                              : render::GraphicsAPI::Metal;
        editor::RenderWindow window(config);
        e.window = &window;
        window.SetLighting(render::LightingMode::PBR);
        window.EnableOrbitControls(false);
        render::ParameterPanelConfig panel;
        panel.showBuiltinPanel = false;
        panel.configureUI      = [] { editor::theme::configure(1); };
        panel.sceneViewport    = [&] { return e.viewportRect; };
        panel.drawUI           = [&] { e.draw(); };
        if (!window.EnableParameterPanel(panel))
            throw std::runtime_error("UI required");
        e.pendingFocus = "*";
        e.syncScene();
        e.syncSceneObjects();
        const auto initial = window.GetLights();
        if (initial.size() != 3)
            throw std::runtime_error("Missing initial three light types");
        std::string point, spot;
        for (const auto& light : initial)
        {
            if (light.type == render::LightType::Point)
                point = light.id;
            if (light.type == render::LightType::Spot)
                spot = light.id;
        }
        if (point.empty() || spot.empty())
            throw std::runtime_error("Missing point/spot");
        int frames = 0;
        while (window.PollEvents() && frames < 120)
        {
            if (frames == 10)
                e.select(point);
            if (frames == 30)
                e.change([&](auto& s) { editor::setPrimary(s, point, "light", false); });
            if (frames == 40)
            {
                auto lamps = window.GetLights();
                for (const auto& l : lamps)
                    if (l.id == point && l.enabled)
                        throw std::runtime_error("Point toggle did not reach renderer");
                e.history.undo();
                e.syncSceneObjects();
            }
            if (frames == 50)
            {
                e.select(spot);
                e.change([&](auto& s) {
                    for (auto& n : s["nodes"])
                        if (n["id"] == spot)
                            n["light"]["outerConeAngle"] = .9;
                });
            }
            if (frames == 60)
            {
                for (const auto& l : window.GetLights())
                    if (l.id == spot && std::abs(l.outerConeAngle - .9f) > 1e-5)
                        throw std::runtime_error("Cone edit missing");
            }
            if (window.DrawFrame() == render::FrameResult::Rendered)
                frames++;
            e.flush();
        }
        window.WaitIdle();
        if (frames != 120 || window.ValidationErrorCount() || e.status.find("error:") != std::string::npos)
            throw std::runtime_error("Native lighting frames failed");
        std::cout << "PASS " << api
                  << " editor: 120 frames, three simultaneous light types, point enable/undo, spot cone "
                     "edits, native UI and zero GPU errors\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
