#include "Persistence.hpp"
#include "SceneObjects.hpp"
#include <iostream>
void require(bool value, const char* text)
{
    if (!value)
        throw std::runtime_error(text);
}
void close(double a, double b)
{
    if (std::abs(a - b) > 3e-5)
        throw std::runtime_error("Camera lens numeric mismatch");
}
int main(int argc, char** argv)
{
    try
    {
        auto root = std::filesystem::absolute(argv[1]);
        auto f = editor::Json::parse(std::ifstream(root / "tests/fixtures/camera-lens.json")), s = f["scene"];
        editor::validate(s);
        auto c    = *editor::sceneCamera(s);
        auto view = editor::renderCamera(c);
        for (int k = 0; k < 3; k++)
            close(view.position[k], f["expected"]["position"][k]);
        for (int k = 0; k < 4; k++)
            close(view.orientation[k], f["expected"]["orientation"][k]);
        close(view.verticalFov, 72);
        close(view.nearPlane, .25);
        close(view.farPlane, 1500);
        for (double pitch : {-90., -89.999, 0., 89.999, 90.})
        {
            s["nodes"][1]["parentId"] = nullptr;
            editor::aimObject(s, "camera", 123, pitch, 67);
            auto m     = editor::objectFrame(s, "camera");
            auto basis = editor::cameraFrame(editor::navigationCamera(*editor::sceneCamera(s)));
            for (int k = 0; k < 3; k++)
            {
                close(basis.right[k], m[k]);
                close(basis.up[k], m[4 + k]);
            }
        }
        s                                     = f["scene"];
        s["nodes"][1]["camera"]["projection"] = "orthographic";
        close(editor::renderCamera(*editor::sceneCamera(s)).orthographicHeight, 8);
        editor::History h;
        h.scene                                      = f["scene"];
        auto changed                                 = h.scene;
        changed["nodes"][1]["camera"]["verticalFov"] = 105;
        changed["nodes"][1]["camera"]["nearPlane"]   = 1;
        changed["nodes"][1]["camera"]["farPlane"]    = 3500;
        editor::aimObject(changed, "camera", 40, -20, -55);
        h.commit(changed);
        h.undo();
        require(h.scene == f["scene"], "lens undo");
        h.redo();
        require(h.scene == changed, "lens redo");
        auto folder = root / "output/camera-lens-contract";
        std::filesystem::create_directories(folder);
        editor::saveProject(folder / "project.json", changed, folder);
        require(editor::read(folder / "project.json") == changed, "lens save restore");
        editor::saveRecovery(folder / "recovery", changed, f["scene"], folder / "project.json", folder);
        require(editor::readRecovery(folder / "recovery").scene == changed, "lens recovery");
        for (int bad = 0; bad < 5; bad++)
        {
            auto invalid = changed;
            if (bad == 0)
                invalid["nodes"][1]["camera"]["nearPlane"] = 0;
            if (bad == 1)
                invalid["nodes"][1]["camera"]["farPlane"] = .1;
            if (bad == 2)
                invalid["nodes"][1]["camera"]["verticalFov"] = 180;
            if (bad == 3)
                invalid["schemaVersion"] = 4;
            if (bad == 4)
                invalid["nodes"][1]["camera"].erase("farPlane");
            bool rejected = false;
            try
            {
                editor::validate(invalid);
            }
            catch (...)
            {
                rejected = true;
            }
            require(rejected, "invalid lens accepted");
        }
        editor::OrbitCamera capture;
        capture.yaw         = 10;
        capture.pitch       = 15;
        capture.roll        = 25;
        capture.distance    = 8;
        capture.verticalFov = 80;
        capture.nearPlane   = .2;
        capture.farPlane    = 2000;
        auto captured       = f["scene"];
        editor::captureCamera(captured, "camera", capture);
        editor::validate(captured);
        auto a = editor::renderCamera(*editor::sceneCamera(captured)), b = editor::renderCamera(capture);
        for (int k = 0; k < 3; k++)
            close(a.position[k], b.position[k]);
        for (int k = 0; k < 4; k++)
            close(a.orientation[k], b.orientation[k]);
        if (argc > 2)
        {
            render::WindowConfig config;
            config.width  = 1000;
            config.height = 700;
            config.title  = "Nova camera lens regression";
            editor::RenderWindow window(config);
            window.SetScene({{"ground", root / "resources/viewport/ground.glb"}}, {{"ground", "ground"}});
            int frames = 0;
            for (int i = 0; i < 90 && window.PollEvents(); i++)
            {
                capture.orthographic = i >= 30;
                capture.verticalFov  = i < 30 ? 30 : 95;
                capture.nearPlane    = i < 60 ? .2f : 20.f;
                capture.farPlane     = 1000;
                capture.roll         = float(i - 45);
                window.SetCamera(capture);
                auto actual = window.GetViewCamera();
                close(actual.verticalFov, capture.verticalFov);
                close(actual.nearPlane, capture.nearPlane);
                close(actual.farPlane, capture.farPlane);
                if (window.DrawFrame() == render::FrameResult::Rendered)
                    frames++;
            }
            window.WaitIdle();
            require(frames == 90 && window.ValidationErrorCount() == 0, "lens GPU validation");
        }
        std::cout << "Camera FOV/clipping/roll, parent capture, v5 validation, history/save/recovery and optional GPU "
                     "checks passed\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
