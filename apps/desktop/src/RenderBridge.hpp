#pragma once
#include <cmath>
#include <render/Window.hpp>
namespace editor
{
    // Navigation and project state belong to the editor. Only formal SDK camera/fog APIs cross this bridge.
    struct OrbitCamera
    {
        float                yaw = 0, pitch = 0, distance = 3.6f, exposure = 1;
        std::array<float, 3> target{0, 0, 0};
        bool                 orthographic = false;
    };
    inline render::Camera renderCamera(const OrbitCamera& c)
    {
        const double   radians = 3.141592653589793 / 180, y = c.yaw * radians, p = c.pitch * radians;
        render::Camera view;
        view.position = {
          float(c.target[0] + c.distance * std::cos(p) * std::sin(y)),
          float(c.target[1] + c.distance * std::sin(p)),
          float(c.target[2] + c.distance * std::cos(p) * std::cos(y))};
        view.orientation = {
          float(-std::cos(y / 2) * std::sin(p / 2)),
          float(std::sin(y / 2) * std::cos(p / 2)),
          float(std::sin(y / 2) * std::sin(p / 2)),
          float(std::cos(y / 2) * std::cos(p / 2))};
        view.projection         = c.orthographic ? render::Projection::Orthographic : render::Projection::Perspective;
        view.orthographicHeight = 2 * c.distance * float(std::tan(3.141592653589793 / 8));
        view.exposure           = c.exposure;
        return view;
    }
    struct EnvironmentSettings : render::EnvironmentSettings
    {
        std::array<float, 3> fogColor{.3185468f, .3185468f, .3185468f};
        int                  fogMode = 0;
        float                fogNear = 10, fogFar = 50, fogDensity = .02f;
    };
    class RenderWindow : public render::Window
    {
        OrbitCamera navigation;

      public:
        using render::Window::Window;
        void SetCamera(const OrbitCamera& camera)
        {
            SetViewCamera(renderCamera(camera));
            navigation = camera;
        }
        OrbitCamera GetCamera() const { return navigation; }
        void        SetEnvironment(const EnvironmentSettings& value)
        {
            render::FogSettings fog;
            fog.mode         = static_cast<render::FogMode>(value.fogMode);
            fog.color        = value.fogColor;
            fog.nearDistance = value.fogNear;
            fog.farDistance  = value.fogFar;
            fog.density      = value.fogDensity;
            SetFog(fog);
            render::Window::SetEnvironment(value);
        }
        EnvironmentSettings GetEnvironment() const
        {
            EnvironmentSettings result;
            static_cast<render::EnvironmentSettings&>(result) = render::Window::GetEnvironment();
            const auto fog                                    = GetFog();
            result.fogMode                                    = int(fog.mode);
            result.fogColor                                   = fog.color;
            result.fogNear                                    = fog.nearDistance;
            result.fogFar                                     = fog.farDistance;
            result.fogDensity                                 = fog.density;
            return result;
        }
    };
} // namespace editor
