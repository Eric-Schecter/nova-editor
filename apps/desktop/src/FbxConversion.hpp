#pragma once
#include "Assets.hpp"
#include <cstdlib>

#ifdef _WIN32
#include <process.h>
#else
#include <cerrno>
#include <spawn.h>
#include <sys/wait.h>
extern char** environ;
#endif

namespace editor::assets
{
    inline void runModelConverter(
      std::filesystem::path executable, const std::filesystem::path& source, const std::filesystem::path& target)
    {
#ifdef _WIN32
        executable += ".exe";
#endif
        if (!std::filesystem::is_regular_file(executable))
            throw std::runtime_error("Bundled model converter is missing");
        if (!std::filesystem::is_regular_file(source) || std::filesystem::file_size(source) > maxBytes)
            throw std::runtime_error("Missing model or input exceeds 128 MiB");
        const std::vector<std::filesystem::path> args{executable, source, target};
#ifdef _WIN32
        std::vector<const wchar_t*> argv;
        for (const auto& arg : args)
            argv.push_back(arg.c_str());
        argv.push_back(nullptr);
        const auto result = _wspawnv(_P_WAIT, executable.c_str(), argv.data());
        if (result == -1)
            throw std::runtime_error("Could not start the bundled model converter");
        const bool success = result == 0;
#else
        std::vector<char*> argv;
        for (const auto& arg : args)
            argv.push_back(const_cast<char*>(arg.c_str()));
        argv.push_back(nullptr);
        pid_t process{};
        if (posix_spawn(&process, executable.c_str(), nullptr, nullptr, argv.data(), environ))
            throw std::runtime_error("Could not start the bundled model converter");
        int   status = 0;
        pid_t result;
        do
        {
            result = waitpid(process, &status, 0);
        } while (result < 0 && errno == EINTR);
        const bool success = result == process && WIFEXITED(status) && WEXITSTATUS(status) == 0;
#endif
        if (!success || !std::filesystem::is_regular_file(target))
            throw std::runtime_error("Could not convert this model; see console");
        const auto size = std::filesystem::file_size(target);
        if (!size || size > maxBytes)
            throw std::runtime_error("Converted model exceeds 128 MiB or is empty");
    }
    inline void convertFBX(const std::filesystem::path& worker, const std::filesystem::path& source,
                           const std::filesystem::path& target)
    {
        runModelConverter(worker / "nova_fbx", source, target);
    }
} // namespace editor::assets
