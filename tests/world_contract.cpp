#include "../apps/desktop/src/RenderBridge.hpp"
#define NOVA_EDITOR_TEST
#include "../apps/desktop/src/main.cpp"
void require(bool v, const char* text)
{
    if (!v)
        throw std::runtime_error(text);
}
int main(int argc, char** argv)
{
    try
    {
        auto root = std::filesystem::absolute(argv[1]);
        auto temp = root / "output/world-contract";
        std::filesystem::create_directories(temp / "source/assets");
        std::filesystem::copy_file(
          root / "resources/environments/studio_small_09.nenv",
          temp / "source/assets/studio.nenv",
          std::filesystem::copy_options::overwrite_existing);
        auto bytes = editor::assets::readBytes(temp / "source/assets/studio.nenv");
        editor::validateEnvironmentBytes(bytes);
        auto world                   = editor::defaultWorld();
        world["environment"]["map"]  = "assets/studio.nenv";
        world["environment"]["name"] = "Studio";
        world["background"]["mode"]  = "environment";
        world["fog"]["mode"]         = "linear";
        auto settings                = editor::environmentSettings(world);
        require(settings.fogMode == 1 && settings.showBackground, "settings conversion");
        require(std::abs(settings.fogColor[0] - .3185468f) < 1e-6, "color conversion");
        Editor e;
        e.assetRoot                      = temp / "source";
        e.history.scene["schemaVersion"] = 4;
        e.history.scene["world"]         = world;
        e.recoveryBase                   = temp / "recovery";
        e.scanRecovery();
        std::snprintf(e.projectPath, sizeof(e.projectPath), "%s", (temp / "dest/project.json").string().c_str());
        e.save();
        require(std::filesystem::file_size(temp / "dest/assets/studio.nenv") == bytes.size(), "save as environment");
        auto restored = editor::read(temp / "dest/project.json");
        require(restored["world"] == world, "restore world");
        e.change([](auto& s) {
            s["world"]["environment"]["map"] = nullptr;
            s["world"]["background"]["mode"] = "color";
        });
        std::snprintf(e.projectPath, sizeof(e.projectPath), "%s", (temp / "second/project.json").string().c_str());
        e.save();
        e.history.undo();
        require(std::filesystem::exists(temp / "second/assets/studio.nenv"), "save as undo dependencies");
        e.autosave(true);
        auto recovery = editor::readRecovery(e.recoveryFolder);
        require(
          recovery.scene["world"] == world && std::filesystem::exists(recovery.root / "assets/studio.nenv"),
          "recovery environment");
        if (argc > 2)
        {
            render::WindowConfig config;
            config.width  = 1000;
            config.height = 700;
            config.title  = "Nova atmosphere regression";
            editor::RenderWindow w(config);
            auto           model = root / "resources/viewport/ground.glb";
            w.SetScene({{"ground", model}}, {{"ground", "ground"}});
            w.LoadEnvironment(temp / "source/assets/studio.nenv");
            int rendered = 0;
            for (int i = 0; i < 90 && w.PollEvents(); i++)
            {
                settings.fogMode        = i < 30 ? 1 : 2;
                settings.fogDensity     = .08f;
                settings.rotation       = float(i);
                settings.showBackground = i < 60;
                w.SetEnvironment(settings);
                if (i == 60)
                    w.LoadEnvironment({});
                auto c         = w.GetCamera();
                c.orthographic = i >= 30;
                c.distance     = 8;
                w.SetCamera(c);
                if (w.DrawFrame() == render::FrameResult::Rendered)
                    rendered++;
                require(w.GetEnvironment().fogMode == settings.fogMode, "fog settings readback");
            }
            w.WaitIdle();
            require(rendered == 90, "GPU regression incomplete");
            require(w.ValidationErrorCount() == 0, "GPU validation");
        }
        std::cout << "World settings, SaveAs, history, recovery and optional GPU transitions passed\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
