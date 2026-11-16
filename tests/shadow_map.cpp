#include <iostream>
#include <render/ShadowMap.hpp>
float depthAt(const render::ShadowMap& map, render::ShadowPoint p)
{
    auto& m = map.uniforms;
    float u = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], v = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    return map.depth[unsigned(v * map.Resolution) * map.Resolution + unsigned(u * map.Resolution)];
}
float projectedDepth(const render::ShadowMap& map, render::ShadowPoint p)
{
    auto& m = map.uniforms;
    return m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
}
int main()
{
    try
    {
        std::vector<render::ShadowTriangle> triangles{
          {{{-1, 1, -1}, {1, 1, -1}, {1, 1, 1}}}, {{{-1, 1, -1}, {1, 1, 1}, {-1, 1, 1}}}};
        auto map = render::BuildShadowMap(triangles, {0, 1, 0});
        if (map.uniforms[17] != 1 || projectedDepth(map, {0, 0, 0}) <= depthAt(map, {0, 0, 0}) + .01f)
            throw std::runtime_error("Ground shadow missing");
        auto offset = render::BuildShadowMap(triangles, {-1, 1, 0});
        if (projectedDepth(offset, {1, 0, 0}) <= depthAt(offset, {1, 0, 0}) + .01f)
            throw std::runtime_error("Directional projection missing");
        if (depthAt(map, {0, 2, 0}) < projectedDepth(map, {0, 2, 0}))
            throw std::runtime_error("Surface above caster shadowed");
        auto empty = render::BuildShadowMap({}, {0, 1, 0});
        if (empty.uniforms[17] != 0)
            throw std::runtime_error("Empty scene shadow enabled");
        bool rejected = false;
        try
        {
            render::BuildShadowMap(triangles, {0, 0, 0});
        }
        catch (...)
        {
            rejected = true;
        }
        if (!rejected)
            throw std::runtime_error("Invalid light accepted");
        std::cout << "Native shadow map ground projection, elevated receiver, light direction and empty scene passed\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
