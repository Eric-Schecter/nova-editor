#pragma once
#include "Transforms.hpp"

namespace editor
{
    inline auto previewWorldMatrices(const Json& authored, double seconds)
    {
        auto snapshot = authored;
        constexpr double pi = 3.14159265358979323846;
        for (auto& node : snapshot["nodes"])
        {
            if (!node.contains("previewBehavior")) continue;
            const auto& behavior = node["previewBehavior"];
            const auto amount = behavior.at("amount").get<double>();
            auto& transform = node["transform"];
            if (behavior["kind"] == "bob")
                transform["position"][1] = transform["position"][1].get<double>() + std::sin(seconds * pi * 2) * amount;
            else
            {
                const auto q = transform["rotation"].get<std::array<double, 4>>();
                const auto half = seconds * amount * pi / 360;
                const auto s = std::sin(half), c = std::cos(half);
                transform["rotation"] = {q[0]*c-q[2]*s, q[1]*c+q[3]*s, q[2]*c+q[0]*s, q[3]*c-q[1]*s};
            }
        }
        return worldMatrices(snapshot);
    }
}
