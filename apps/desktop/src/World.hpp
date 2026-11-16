#pragma once
#include "Scene.hpp"
namespace editor
{
    inline std::set<std::string> projectPaths(const Json& s)
    {
        std::set<std::string> paths;
        for (const auto& a : s["assets"])
            paths.insert(a["path"].get<std::string>());
        if (s.contains("world") && !s["world"]["environment"]["map"].is_null())
            paths.insert(s["world"]["environment"]["map"].get<std::string>());
        return paths;
    }
} // namespace editor
