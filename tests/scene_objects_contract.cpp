#include "../apps/desktop/src/RenderBridge.hpp"
#include "../apps/desktop/src/SceneObjects.hpp"
#include <iostream>
void require(bool value, const char* text)
{
    if (!value)
        throw std::runtime_error(text);
}
void close(double a, double b)
{
    if (std::abs(a - b) > 2e-4)
        throw std::runtime_error("Scene camera / light numeric mismatch");
}
int main(int argc, char** argv)
{
    try
    {
        auto fixture = editor::Json::parse(std::ifstream(std::filesystem::path(argv[1]) / "scene-objects.json"));
        auto scene   = fixture["scene"];
        editor::validate(scene);
        auto camera = editor::sceneCamera(scene);
        require(camera.has_value(), "Missing main camera");
        close(camera->yaw, 25);
        close(camera->pitch, 20);
        close(camera->distance, 9);
        close(camera->exposure, 1.2);
        close(camera->target[1], 1);
        editor::setPrimary(scene, "camera-side", "camera");
        camera = editor::sceneCamera(scene);
        require(camera->orthographic, "Orthographic mode lost");
        close(2 * camera->distance * std::tan(3.141592653589793 / 8), 7);
        for (float pitch : {-90.f, 90.f})
        {
            editor::aimObject(scene, "camera-side", 35, pitch);
            auto c = *editor::sceneCamera(scene);
            close(c.pitch, pitch);
            auto ray = editor::rayAt(
              {400, 300},
              {c.yaw, c.pitch, c.distance, c.orthographic, {c.target[0], c.target[1], c.target[2]}},
              {800, 600});
            auto frame = editor::cameraFrame(
              {c.yaw, c.pitch, c.distance, c.orthographic, {c.target[0], c.target[1], c.target[2]}});
            require(editor::dot(frame.forward, ray.direction) > .9999, "Pole camera ray mismatch");
        }
        editor::OrbitCamera capture;
        capture.yaw      = -40;
        capture.pitch    = 30;
        capture.distance = 7;
        capture.exposure = 2;
        capture.target   = {2, 1, -3};
        editor::captureCamera(scene, "camera-side", capture);
        camera = editor::sceneCamera(scene);
        close(camera->yaw, -40);
        close(camera->pitch, 30);
        for (int k = 0; k < 3; k++)
            close(camera->target[k], capture.target[k]);
        auto light = editor::sceneDirectional(scene);
        require(light && light->id == "sun", "Missing active light");
        auto direction = editor::unit({-1, 1.6, 2});
        for (int k = 0; k < 3; k++)
            close(light->light.direction[k], direction[k]);
        close(light->light.intensity, 4);
        close(light->shadows.softness, 2);
        scene["nodes"][2]["hidden"] = true;
        light                       = editor::sceneDirectional(scene);
        require(light->light.intensity == 0 && !light->shadows.enabled, "Hidden light still active");
        scene["nodes"][2].erase("hidden");
        editor::setPrimary(scene, "fill", "light");
        require(editor::sceneDirectional(scene)->id == "sun", "Light switch failed");
        auto glyphs = editor::sceneGlyphs(scene);
        require(
          glyphs.size() == 4 && glyphs[0].lines.size() == 11 && glyphs[2].lines.size() == 6, "Helper geometry invalid");
        editor::History h;
        h.replace(scene);
        auto next = scene;
        editor::setPrimary(next, "camera-front", "camera");
        h.commit(next);
        h.undo();
        require(editor::primaryCamera(h.scene) == "camera-side", "Main camera undo failed");
        h.redo();
        require(editor::primaryCamera(h.scene) == "camera-front", "Main camera redo failed");
        size_t index  = 0;
        auto   copied = h.scene;
        editor::duplicateNodes(copied, {"camera-front", "fill"}, [&] { return "copy-" + std::to_string(++index); });
        editor::validate(copied);
        int cameras = 0, lights = 0;
        for (const auto& n : copied["nodes"])
        {
            if (n.contains("camera") && n["camera"]["primary"] == true)
                cameras++;
            if (n.contains("light") && n["light"]["active"] == true)
                lights++;
        }
        require(cameras == 1 && lights == 2, "Duplicate took primary status");
        editor::deleteNodes(copied, {"camera-front"});
        require(editor::primaryCamera(copied).empty(), "Deleted camera still primary");
        for (int invalid = 0; invalid < 6; invalid++)
        {
            auto s = fixture["scene"];
            if (invalid == 0)
                s["schemaVersion"] = 2;
            if (invalid == 1)
                s["nodes"][1]["camera"]["primary"] = true;
            if (invalid == 2)
                s["nodes"][0]["camera"]["exposure"] = 0;
            if (invalid == 3)
                s["nodes"][2]["light"]["type"] = "point";
            if (invalid == 4)
                s["nodes"][2]["light"]["color"] = {1, -1, 0};
            if (invalid == 5)
                s["nodes"][0]["light"] = s["nodes"][2]["light"];
            bool rejected = false;
            try
            {
                editor::validate(s);
            }
            catch (...)
            {
                rejected = true;
            }
            require(rejected, "Invalid component accepted");
        }
        auto rolled                                 = fixture["scene"];
        rolled["nodes"][0]["transform"]["rotation"] = editor::eulerQuaternion({0, 0, 35});
        close(editor::sceneCamera(rolled)->roll, 35);
        std::cout << "Scene object contract: v3 validation, camera / light transforms, orthographic/poles, main "
                     "switching, helpers, duplicate/delete and undo passed\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
