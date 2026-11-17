#pragma once
#include "Gizmo.hpp"
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
        float                roll = 0, verticalFov = 45, nearPlane = .01f, farPlane = 200;
    };
    inline Camera navigationCamera(const OrbitCamera& c)
    {
        return {
          c.yaw,
          c.pitch,
          c.distance,
          c.orthographic,
          {c.target[0], c.target[1], c.target[2]},
          c.roll,
          c.verticalFov,
          c.nearPlane,
          c.farPlane};
    }
    inline render::Camera renderCamera(const OrbitCamera& c)
    {
        auto           f = cameraFrame(navigationCamera(c));
        render::Camera view;
        for (int k = 0; k < 3; k++)
            view.position[k] = float(f.eye[k]);
        view.orientation        = cameraOrientation(c.yaw, c.pitch, c.roll);
        view.projection         = c.orthographic ? render::Projection::Orthographic : render::Projection::Perspective;
        view.orthographicHeight = float(2 * c.distance * cameraTangent(navigationCamera(c)));
        view.verticalFov        = c.verticalFov;
        view.nearPlane          = c.nearPlane;
        view.farPlane           = c.farPlane;
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
