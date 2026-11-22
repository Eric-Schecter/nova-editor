#pragma once
#include <filesystem>
#include <fstream>
#include <string>

namespace editor::language
{
    inline bool chinese = false;
    inline std::filesystem::path preference;

    inline const char* text(const char* english, const char* translated)
    {
        return chinese ? translated : english;
    }

    inline void load(const std::filesystem::path& path)
    {
        preference = path;
        std::ifstream input(path);
        std::string value;
        chinese = (input >> value) && value == "zh";
    }

    inline void set(bool useChinese)
    {
        chinese = useChinese;
        if (preference.empty()) return;
        std::error_code error;
        std::filesystem::create_directories(preference.parent_path(), error);
        if (!error)
            std::ofstream(preference) << (chinese ? "zh" : "en");
    }
}
