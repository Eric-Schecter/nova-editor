#pragma once
#include "Assets.hpp"
#include "RenderBridge.hpp"
#include "World.hpp"
#include <render/Model.hpp>
namespace editor
{
    inline void validateEnvironmentBytes(const assets::Bytes& bytes)
    {
        if (bytes.size() < 160 || bytes.size() > 128 * 1024 * 1024)
            throw std::runtime_error("Invalid .nenv size");
        auto magic    = std::string(bytes.begin(), bytes.begin() + 8);
        bool separate = magic == "NOVENV02";
        if (!separate && magic != "NOVENV01")
            throw std::runtime_error("Choose a Nova preprocessed .nenv file");
        if (separate && bytes.size() < 168)
            throw std::runtime_error("Truncated environment header");
        auto u32 = [&](size_t offset) {
            uint32_t v;
            std::memcpy(&v, bytes.data() + offset, 4);
            return v;
        };
        auto size = [](uint32_t n, uint32_t levels) {
            if (!n || n > 1024 || (n & (n - 1)))
                throw std::runtime_error("Invalid environment mip chain");
            uint32_t count = 0;
            size_t   bytes = 0;
            for (; n; n /= 2)
            {
                count++;
                bytes += size_t(n) * n * 48;
            }
            if (levels != count)
                throw std::runtime_error("Invalid environment mip count");
            return bytes;
        };
        size_t header   = separate ? 168 : 160,
               expected = header + size(u32(8), u32(12)) + (separate ? size(u32(160), u32(164)) : 0);
        if (expected != bytes.size())
            throw std::runtime_error("Environment payload size mismatch");
        for (size_t i = 0; i < 36; i++)
        {
            float f;
            std::memcpy(&f, bytes.data() + 16 + 4 * i, 4);
            if (!std::isfinite(f))
                throw std::runtime_error("Invalid irradiance");
        }
        for (size_t i = header; i < bytes.size(); i += 2)
        {
            uint16_t half;
            std::memcpy(&half, bytes.data() + i, 2);
            if ((half & 0x7c00) == 0x7c00)
                throw std::runtime_error("Invalid environment pixel");
        }
    }
    inline std::array<float, 3> worldColor(const std::string& hex, bool linear = true)
    {
        std::array<float, 3> out;
        for (int k = 0; k < 3; k++)
        {
            float c = float(std::stoi(hex.substr(1 + k * 2, 2), nullptr, 16)) / 255.f;
            out[k]  = linear ? (c <= .04045f ? c / 12.92f : std::pow((c + .055f) / 1.055f, 2.4f)) : c;
        }
        return out;
    }
    inline editor::EnvironmentSettings environmentSettings(const Json& world)
    {
        validateWorld(world);
        editor::EnvironmentSettings out;
        const auto&                 e = world["environment"];
        const auto&                 f = world["fog"];
        out.rotation                  = e["rotation"];
        out.intensity                 = e["intensity"];
        out.backgroundIntensity       = e["backgroundIntensity"];
        out.showBackground            = world["background"]["mode"] == "environment";
        out.fogColor                  = worldColor(f["color"]);
        out.fogMode                   = f["mode"] == "none" ? 0 : f["mode"] == "linear" ? 1 : 2;
        out.fogNear                   = f["near"];
        out.fogFar                    = f["far"];
        out.fogDensity                = f["density"];
        return out;
    }
} // namespace editor
