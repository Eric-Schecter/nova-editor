#pragma once
#include "RenderBridge.hpp"
#include <cmath>
#include <render/Model.hpp>
namespace editor
{
    struct StudioSettings
    {
        float azimuth   = float(std::atan2(-1., 2.) * 180 / 3.141592653589793),
              elevation = float(std::atan2(1.6, std::sqrt(5.)) * 180 / 3.141592653589793);
        std::array<float, 3>     color{1, 1, 1};
        float                    intensity = 3.5f;
        bool                     shadows   = true;
        float                    softness  = 1;
        render::DirectionalLight light() const
        {
            constexpr double radians = 3.141592653589793 / 180;
            double           a = azimuth * radians, e = elevation * radians;
            auto             linear = color;
            for (auto& c : linear)
                c = c <= .04045f ? c / 12.92f : std::pow((c + .055f) / 1.055f, 2.4f);
            return {
              {float(std::sin(a) * std::cos(e)), float(std::sin(e)), float(std::cos(a) * std::cos(e))},
              linear,
              intensity};
        }
    };
} // namespace editor
