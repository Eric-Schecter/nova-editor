#pragma once
#include "Transforms.hpp"
#include <optional>
namespace editor
{
    using V3 = std::array<double, 3>;
    struct Screen
    {
        double x = 0, y = 0;
    };
    struct Camera
    {
        double yaw = 25, pitch = 20, distance = 8;
        bool   orthographic = false;
        V3     target{0, 0, 0};
        double roll = 0, verticalFov = 45, nearPlane = .01, farPlane = 200;
    };
    struct Size
    {
        double width = 1, height = 1;
    };
    enum class Tool
    {
        Translate,
        Rotate,
        Scale
    };
    inline V3 add(V3 a, V3 b)
    {
        for (int i = 0; i < 3; ++i)
            a[i] += b[i];
        return a;
    }
    inline V3 sub(V3 a, V3 b)
    {
        for (int i = 0; i < 3; ++i)
            a[i] -= b[i];
        return a;
    }
    inline V3 times(V3 a, double s)
    {
        for (auto& v : a)
            v *= s;
        return a;
    }
    inline double dot(V3 a, V3 b)
    {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }
    inline V3 cross(V3 a, V3 b)
    {
        return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
    }
    inline V3 unit(V3 a)
    {
        return times(a, 1 / std::max(1e-20, std::sqrt(dot(a, a))));
    }
    inline V3 axis(int k)
    {
        V3 a{};
        if (k >= 0 && k < 3)
            a[k] = 1;
        return a;
    }
    inline V3 point(const Matrix& m, V3 v, double w = 1)
    {
        V3 out{};
        for (int r = 0; r < 3; ++r)
            out[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w;
        return out;
    }
    inline V3 pivot(const Matrix& m)
    {
        return {m[12], m[13], m[14]};
    }
    inline std::optional<Matrix> inverse(const Matrix& m)
    {
        V3                a{m[0], m[1], m[2]}, b{m[4], m[5], m[6]}, c{m[8], m[9], m[10]};
        std::array<V3, 3> rows{cross(b, c), cross(c, a), cross(a, b)};
        double            det = dot(a, rows[0]);
        if (std::abs(det) < 1e-12)
            return {};
        Matrix out{};
        for (int c = 0; c < 3; ++c)
            for (int r = 0; r < 3; ++r)
                out[c * 4 + r] = float(rows[r][c] / det);
        out[15] = 1;
        auto t  = times(point(out, pivot(m), 0), -1);
        for (int k = 0; k < 3; ++k)
            out[12 + k] = float(t[k]);
        return out;
    }
    struct CameraFrame
    {
        V3 eye, forward, right, up;
    };
    inline double cameraTangent(const Camera& c)
    {
        return std::tan(c.verticalFov * 3.141592653589793 / 360);
    }
    inline std::array<float, 4> cameraOrientation(double yaw, double pitch, double roll = 0)
    {
        double y = yaw * 3.141592653589793 / 360, p = pitch * 3.141592653589793 / 360,
               r = roll * 3.141592653589793 / 360, x = -std::cos(y) * std::sin(p), qy = std::sin(y) * std::cos(p),
               z = std::sin(y) * std::sin(p), w = std::cos(y) * std::cos(p);
        return {
          float(x * std::cos(r) + qy * std::sin(r)),
          float(qy * std::cos(r) - x * std::sin(r)),
          float(z * std::cos(r) + w * std::sin(r)),
          float(w * std::cos(r) - z * std::sin(r))};
    }
    inline CameraFrame cameraFrame(Camera c)
    {
        double      y = c.yaw * 3.141592653589793 / 180, p = c.pitch * 3.141592653589793 / 180;
        CameraFrame f;
        f.eye = {
          c.distance * std::cos(p) * std::sin(y), c.distance * std::sin(p), c.distance * std::cos(p) * std::cos(y)};
        f.forward    = unit(times(f.eye, -1));
        f.right      = {std::cos(y), 0, -std::sin(y)};
        f.up         = cross(f.right, f.forward);
        auto   right = f.right, up = f.up;
        double roll = c.roll * 3.141592653589793 / 180;
        f.right     = add(times(right, std::cos(roll)), times(up, std::sin(roll)));
        f.up        = add(times(up, std::cos(roll)), times(right, -std::sin(roll)));
        f.eye       = add(f.eye, c.target);
        return f;
    }
    struct Ray
    {
        V3 origin, direction;
    };
    inline std::optional<Screen> project(V3 v, Camera c, Size s)
    {
        auto   f     = cameraFrame(c);
        auto   rel   = sub(v, f.eye);
        double depth = dot(rel, f.forward);
        if (depth < c.nearPlane || depth > c.farPlane)
            return {};
        double scale = s.height / (2 * cameraTangent(c) * (c.orthographic ? c.distance : depth));
        return Screen{s.width / 2 + dot(rel, f.right) * scale, s.height / 2 - dot(rel, f.up) * scale};
    }
    inline Ray rayAt(Screen p, Camera c, Size s)
    {
        auto   f = cameraFrame(c);
        double x = (p.x * 2 / s.width - 1) * (s.width / s.height) * cameraTangent(c),
               y = (1 - p.y * 2 / s.height) * cameraTangent(c);
        if (c.orthographic)
            return {
              add(
                add(f.eye, add(times(f.right, x * c.distance), times(f.up, y * c.distance))),
                times(f.forward, c.nearPlane * (1 + 1e-6))),
              f.forward};
        auto direction = unit(add(f.forward, add(times(f.right, x), times(f.up, y))));
        return {add(f.eye, times(direction, c.nearPlane * (1 + 1e-6) / dot(direction, f.forward))), direction};
    }
    struct GizmoLine
    {
        int                 axis;
        std::vector<Screen> points;
    };
    struct Gizmo
    {
        Tool                   mode;
        Matrix                 basis, inv;
        double                 radius;
        Screen                 pivot;
        std::vector<GizmoLine> lines;
        std::string            id;
        Json                   local;
        Camera                 camera;
        Size                   size;
    };
    inline std::optional<Gizmo> gizmoFor(const Json& scene, const std::string& id, Tool mode, Camera camera, Size size)
    {
        const Json* node = nullptr;
        for (const auto& n : scene["nodes"])
            if (n["id"] == id)
                node = &n;
        if (!node || size.width <= 0 || size.height <= 0)
            return {};
        auto worlds = worldMatrices(scene);
        auto parent =
          (*node)["parentId"].is_null() ? localMatrix(identity()) : worlds.at((*node)["parentId"].get<std::string>());
        auto local     = (*node)["transform"];
        local["scale"] = {1, 1, 1};
        auto basis     = mode == Tool::Translate ? parent : multiply(parent, localMatrix(local));
        auto world     = worlds.at(id);
        for (int i = 0; i < 3; ++i)
            basis[12 + i] = world[12 + i];
        auto inv = inverse(basis);
        auto p   = project(pivot(world), camera, size);
        if (!inv || !p)
            return {};
        auto   f     = cameraFrame(camera);
        double depth = dot(sub(pivot(world), f.eye), f.forward), maxLength = 0;
        for (int i = 0; i < 3; ++i)
            maxLength = std::max(
              maxLength,
              std::sqrt(
                double(basis[i * 4]) * basis[i * 4] + double(basis[i * 4 + 1]) * basis[i * 4 + 1]
                + double(basis[i * 4 + 2]) * basis[i * 4 + 2]));
        double radius =
          82 * 2 * cameraTangent(camera) * (camera.orthographic ? camera.distance : depth) / size.height / maxLength;
        Gizmo g{mode, basis, *inv, radius, *p, {}, id, (*node)["transform"], camera, size};
        for (int k = 0; k < 3; ++k)
        {
            GizmoLine line{k, {}};
            if (mode == Tool::Rotate)
            {
                for (int i = 0; i <= 64; ++i)
                {
                    V3 v{};
                    v[(k + 1) % 3] = std::cos(i * 3.141592653589793 / 32) * radius;
                    v[(k + 2) % 3] = std::sin(i * 3.141592653589793 / 32) * radius;
                    auto q         = project(point(basis, v), camera, size);
                    if (q)
                        line.points.push_back(*q);
                }
            }
            else
            {
                line.points.push_back(*p);
                auto q = project(point(basis, times(axis(k), radius)), camera, size);
                if (q)
                    line.points.push_back(*q);
            }
            g.lines.push_back(line);
        }
        return g;
    }
    inline double screenLength(Screen a, Screen b)
    {
        return std::hypot(a.x - b.x, a.y - b.y);
    }
    inline double segmentDistance(Screen p, Screen a, Screen b)
    {
        double x = b.x - a.x, y = b.y - a.y, l = x * x + y * y,
               t = l ? std::clamp(((p.x - a.x) * x + (p.y - a.y) * y) / l, 0., 1.) : 0;
        return std::hypot(p.x - a.x - x * t, p.y - a.y - y * t);
    }
    inline std::optional<int> hitGizmo(const Gizmo& g, Screen p)
    {
        if (g.mode != Tool::Rotate && screenLength(p, g.pivot) < 10)
            return -1;
        double             best = 9;
        std::optional<int> result;
        for (const auto& line : g.lines)
            for (size_t i = 1; i < line.points.size(); ++i)
            {
                auto a = line.points[i - 1], b = line.points[i];
                if (g.mode != Tool::Rotate && (screenLength(a, b) < 18 || screenLength(p, g.pivot) < 18))
                    continue;
                double d = segmentDistance(p, a, b);
                if (d < best)
                {
                    best   = d;
                    result = line.axis;
                }
            }
        return result;
    }
    inline std::optional<double> axisParameter(V3 o, V3 d, int k)
    {
        double dd = dot(d, d), den = dd - d[k] * d[k];
        if (den < 1e-10 * dd)
            return {};
        return (o[k] * dd - d[k] * dot(o, d)) / den;
    }
    inline Ray localRay(const Gizmo& g, Screen p)
    {
        auto r = rayAt(p, g.camera, g.size);
        return {point(g.inv, r.origin), point(g.inv, r.direction, 0)};
    }
    inline std::optional<V3> planeVector(V3 o, V3 d, int k)
    {
        if (std::abs(d[k]) < 1e-10)
            return {};
        return add(o, times(d, -o[k] / d[k]));
    }
    struct Drag
    {
        Gizmo  gizmo;
        int    axis;
        Screen start;
        double parameter;
        V3     vector, plane, worldAnchor;
    };
    inline std::optional<Drag> beginDrag(const Gizmo& g, int k, Screen start)
    {
        if (k < -1 || k > 2 || (g.mode == Tool::Rotate && k < 0))
            return {};
        auto   r = localRay(g, start), worldRay = rayAt(start, g.camera, g.size);
        auto   plane = cameraFrame(g.camera).forward;
        double den   = dot(worldRay.direction, plane);
        auto   anchor =
          std::abs(den) > 1e-10
              ? add(worldRay.origin, times(worldRay.direction, dot(sub(pivot(g.basis), worldRay.origin), plane) / den))
              : pivot(g.basis);
        auto vector = g.mode == Tool::Rotate ? planeVector(r.origin, r.direction, k) : std::optional<V3>(V3{});
        auto parameter =
          k >= 0 && g.mode != Tool::Rotate ? axisParameter(r.origin, r.direction, k) : std::optional<double>(0);
        if (!vector || !parameter)
            return {};
        return Drag{g, k, start, *parameter, *vector, plane, anchor};
    }
    inline Json updateDrag(const Drag& drag, Screen p, bool snap = false, double positionStep = .25, bool alignWorldGrid = false)
    {
        const auto& g     = drag.gizmo;
        int         k     = drag.axis;
        auto        t     = g.local;
        auto        r     = localRay(g, p);
        auto        round = [&](double v, double step) { return snap ? std::round(v / step) * step : v; };
        if (g.mode == Tool::Translate)
        {
            const auto positionDelta = [&](double v, int axis) {
                if (!snap || !alignWorldGrid || std::abs(v) < 1e-9) return round(v, positionStep);
                const auto origin = g.basis[12 + axis];
                return round(origin + v, positionStep) - origin;
            };
            if (k < 0)
            {
                auto   ray = rayAt(p, g.camera, g.size);
                double den = dot(ray.direction, drag.plane);
                if (std::abs(den) > 1e-10)
                {
                    auto q = add(
                           ray.origin, times(ray.direction, dot(sub(pivot(g.basis), ray.origin), drag.plane) / den)),
                         delta = point(g.inv, sub(q, drag.worldAnchor), 0);
                    for (int i = 0; i < 3; ++i)
                        t["position"][i] = t["position"][i].get<double>() + positionDelta(delta[i], i);
                }
            }
            else
            {
                auto v = axisParameter(r.origin, r.direction, k);
                if (v)
                    t["position"][k] = t["position"][k].get<double>() + positionDelta(*v - drag.parameter, k);
            }
        }
        else if (g.mode == Tool::Scale)
        {
            if (k < 0)
            {
                double factor = std::exp(std::clamp((p.x - drag.start.x - p.y + drag.start.y) / 100., -7., 7.));
                for (int i = 0; i < 3; ++i)
                    t["scale"][i] = t["scale"][i].get<double>() * round(factor, .1);
            }
            else
            {
                auto v = axisParameter(r.origin, r.direction, k);
                if (v)
                {
                    double scale  = t["scale"][k];
                    t["scale"][k] = scale + round((*v - drag.parameter) / g.radius * std::max(1., std::abs(scale)), .1);
                }
            }
        }
        else
        {
            auto v = planeVector(r.origin, r.direction, k);
            if (v && dot(*v, *v) > 1e-16 && dot(drag.vector, drag.vector) > 1e-16)
            {
                double angle = round(
                         std::atan2(dot(axis(k), cross(drag.vector, *v)), dot(drag.vector, *v)),
                         3.141592653589793 / 12),
                       a = axis(k)[0] * std::sin(angle / 2), b = axis(k)[1] * std::sin(angle / 2),
                       c = axis(k)[2] * std::sin(angle / 2), e = std::cos(angle / 2), x = t["rotation"][0],
                       y = t["rotation"][1], z = t["rotation"][2], w = t["rotation"][3];
                std::array<double, 4> q{
                  w * a + x * e + y * c - z * b,
                  w * b - x * c + y * e + z * a,
                  w * c + x * b - y * a + z * e,
                  w * e - x * a - y * b - z * c};
                double length = 0;
                for (double f : q)
                    length += f * f;
                for (auto& f : q)
                    f /= std::sqrt(length);
                t["rotation"] = q;
            }
        }
        return t;
    }
} // namespace editor
