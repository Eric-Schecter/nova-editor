#pragma once

#include <filesystem>
#include <string>

enum class Action { Import, Save, Open, Select };

void enqueue(Action action, std::filesystem::path path = {}, std::string label = {});
void showStatus(const std::string& status);
void installControls();
void showModel(const std::string& name, bool selected);
