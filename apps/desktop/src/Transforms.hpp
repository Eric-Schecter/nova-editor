#pragma once
#include "Scene.hpp"
#include <array>
#include <functional>
namespace editor
{
    using Matrix = std::array<float, 16>;
    inline Matrix multiply(const Matrix& a, const Matrix& b)
    {
        Matrix out{};
        for (int c = 0; c < 4; ++c)
            for (int r = 0; r < 4; ++r)
                for (int k = 0; k < 4; ++k)
                    out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
        return out;
    }
    inline Matrix localMatrix(const Json& t)
    {
        float x = t["rotation"][0], y = t["rotation"][1], z = t["rotation"][2], w = t["rotation"][3], a = t["scale"][0],
              b = t["scale"][1], c = t["scale"][2];
        return {
          (1 - 2 * y * y - 2 * z * z) * a,
          (2 * x * y + 2 * z * w) * a,
          (2 * x * z - 2 * y * w) * a,
          0,
          (2 * x * y - 2 * z * w) * b,
          (1 - 2 * x * x - 2 * z * z) * b,
          (2 * y * z + 2 * x * w) * b,
          0,
          (2 * x * z + 2 * y * w) * c,
          (2 * y * z - 2 * x * w) * c,
          (1 - 2 * x * x - 2 * y * y) * c,
          0,
          t["position"][0],
          t["position"][1],
          t["position"][2],
          1};
    }
    inline std::map<std::string, Matrix> worldMatrices(const Json& scene)
    {
        std::map<std::string, const Json*> nodes;
        std::map<std::string, Matrix>      cache;
        for (const auto& n : scene["nodes"])
            nodes[n["id"].get<std::string>()] = &n;
        std::set<std::string>                     visiting;
        std::function<Matrix(const std::string&)> world = [&](const std::string& id) {
            if (cache.count(id))
                return cache.at(id);
            if (!nodes.count(id) || !visiting.insert(id).second)
                throw std::runtime_error("Invalid scene hierarchy");
            const auto& n = *nodes.at(id);
            auto        m = localMatrix(n["transform"]);
            if (!n["parentId"].is_null())
                m = multiply(world(n["parentId"].get<std::string>()), m);
            visiting.erase(id);
            cache[id] = m;
            return m;
        };
        for (const auto& entry : nodes)
            world(entry.first);
        return cache;
    }
    inline std::array<float, 4> eulerQuaternion(const std::array<float, 3>& degrees)
    {
        float x = degrees[0] * 3.14159265358979323846f / 360, y = degrees[1] * 3.14159265358979323846f / 360,
              z = degrees[2] * 3.14159265358979323846f / 360, a = std::cos(x), b = std::cos(y), c = std::cos(z),
              d = std::sin(x), e = std::sin(y), f = std::sin(z);
        return {d * b * c + a * e * f, a * e * c - d * b * f, a * b * f + d * e * c, a * b * c - d * e * f};
    }
    inline std::array<float, 3> quaternionEuler(const Json& q)
    {
        auto t            = identity();
        t["rotation"]     = q;
        auto            m = localMatrix(t);
        constexpr float d = 180 / 3.14159265358979323846f;
        return {
          (std::abs(m[8]) < .9999999f ? std::atan2(-m[9], m[10]) : std::atan2(m[6], m[5])) * d,
          std::asin(std::clamp(m[8], -1.f, 1.f)) * d,
          (std::abs(m[8]) < .9999999f ? std::atan2(-m[4], m[0]) : 0) * d};
    }
} // namespace editor
