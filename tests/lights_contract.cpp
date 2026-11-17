#include "Persistence.hpp"
#include "SceneObjects.hpp"
#include <iostream>
void require(bool ok, const char* text)
{
    if (!ok)
        throw std::runtime_error(text);
}
int main(int argc, char** argv)
{
    try
    {
        auto root = std::filesystem::absolute(argv[1]);
        auto s    = editor::Json::parse(std::ifstream(root / "tests/fixtures/lights.json"));
        editor::validate(s);
        auto lights = editor::sceneLights(s);
        require(lights.size() == 6, "six lights");
        for (const auto& l : lights)
        {
            require(l.enabled && l.range == 10, "enabled/range");
            require(std::abs(l.position[0] - 4) < 1e-5 && std::abs(l.position[2]) < 1e-5, "world position");
            if (l.type != render::LightType::Point)
                require(std::abs(l.direction[0] - (l.type == render::LightType::Spot ? -1 : 1)) < 1e-5, "direction");
        }
        auto glyphs = editor::sceneGlyphs(s);
        require(glyphs[2].lines.size() > 90 && glyphs[4].lines.size() > 70, "range/cone helpers");
        editor::setPrimary(s, lights[0].id, "light", false);
        require(editor::sceneLights(s)[1].enabled, "independent enable");
        editor::History h;
        h.replace(s);
        auto edited                          = s;
        edited["nodes"][3]["light"]["range"] = 3;
        h.commit(edited);
        h.undo();
        require(h.scene == s, "undo");
        h.redo();
        require(h.scene == edited, "redo");
        auto folder = root / "output/lights-contract";
        std::filesystem::create_directories(folder);
        editor::saveProject(folder / "project.json", edited, folder);
        require(editor::read(folder / "project.json") == edited, "save reopen");
        editor::saveRecovery(folder / "recovery", edited, s, folder / "project.json", folder);
        require(editor::readRecovery(folder / "recovery").scene == edited, "recovery");
        for (int i = 0; i < 3; i++)
        {
            auto bad = edited;
            if (i == 0)
                bad["nodes"][3]["light"]["range"] = -1;
            if (i == 1)
                bad["nodes"][5]["light"]["outerConeAngle"] = .1;
            if (i == 2)
                bad["nodes"][3]["light"]["shadows"] = true;
            bool rejected = false;
            try
            {
                editor::validate(bad);
            }
            catch (...)
            {
                rejected = true;
            }
            require(rejected, "bad input accepted");
        }
        std::cout << "PASS six-light scene transforms, independent flags, helpers, history, save and recovery\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
