#include "Gizmo.hpp"
#include "Navigation.hpp"
#include "Placement.hpp"
#include "Scene.hpp"
#include "Transforms.hpp"
#include <iostream>
int main(int argc, char** argv)
{
    try
    {
        if (argc != 2)
            throw std::runtime_error("fixtures required");
        auto root     = std::filesystem::path(argv[1]);
        auto valid    = editor::read(root / "valid.scene.json");
        bool rejected = false;
        try
        {
            editor::read(root / "cycle.scene.json");
        }
        catch (...)
        {
            rejected = true;
        }
        if (!rejected)
            throw std::runtime_error("cycle accepted");
        auto transforms = editor::read(root / "transforms.json");
        auto matrices   = editor::worldMatrices(transforms);
        auto m          = matrices.at("child");
        for (auto expected : {std::pair<int, float>{12, 2}, {13, 2}, {14, 0}, {0, 0}, {1, 2}, {4, -3}, {5, 0}})
            if (std::abs(m[expected.first] - expected.second) > 1e-5f)
                throw std::runtime_error("world transform mismatch");
        editor::History h;
        h.replace(valid);
        auto next = valid;
        editor::removeSubtree(next, "root");
        h.commit(next);
        if (!h.scene["nodes"].empty())
            throw std::runtime_error("delete failed");
        h.undo();
        if (h.scene != valid)
            throw std::runtime_error("undo failed");
        h.redo();
        if (!h.scene["nodes"].empty())
            throw std::runtime_error("redo failed");
        auto savedPath = std::filesystem::current_path() / "scene-contract-save.json";
        editor::save(savedPath, valid);
        auto changed    = valid;
        changed["name"] = "Second save";
        editor::save(savedPath, changed);
        if (editor::read(savedPath) != changed)
            throw std::runtime_error("replacement save failed");
        std::filesystem::remove(savedPath);
        auto invalid                    = valid;
        invalid["nodes"][1]["parentId"] = "missing";
        rejected                        = false;
        try
        {
            h.commit(invalid);
        }
        catch (...)
        {
            rejected = true;
        }
        if (!rejected || !h.scene["nodes"].empty())
            throw std::runtime_error("invalid edit corrupted history");
        editor::Camera camera{25, 20, 8};
        editor::Size   size{900, 700};
        auto           close = [](double a, double b) {
            if (std::abs(a - b) > 1e-3)
                throw std::runtime_error("Gizmo transform mismatch");
        };
        for (int k = 0; k < 3; ++k)
        {
            auto       g = *editor::gizmoFor(valid, "root", editor::Tool::Translate, camera, size);
            editor::V3 a{}, b{};
            a[k]       = g.radius * .8;
            b[k]       = a[k] + .5;
            auto start = *editor::project(editor::point(g.basis, a), camera, size),
                 end   = *editor::project(editor::point(g.basis, b), camera, size);
            auto hit   = editor::hitGizmo(g, start);
            if (!hit || *hit != k)
                throw std::runtime_error("Gizmo handle hit failed");
            auto moved = editor::updateDrag(*editor::beginDrag(g, k, start), end);
            for (int i = 0; i < 3; ++i)
                close(moved["position"][i], i == k ? .5 : 0);
            auto scaled = *editor::gizmoFor(transforms, "child", editor::Tool::Scale, camera, size);
            a           = {};
            b           = {};
            a[k]        = scaled.radius * .8;
            b[k]        = scaled.radius * 1.2;
            start       = *editor::project(editor::point(scaled.basis, a), camera, size);
            end         = *editor::project(editor::point(scaled.basis, b), camera, size);
            auto t      = editor::updateDrag(*editor::beginDrag(scaled, k, start), end);
            close(t["scale"][k], 1.4);
            auto ring      = *editor::gizmoFor(transforms, "child", editor::Tool::Rotate, camera, size);
            a              = {};
            b              = {};
            a[(k + 1) % 3] = ring.radius;
            b[(k + 1) % 3] = std::cos(3.141592653589793 / 4) * ring.radius;
            b[(k + 2) % 3] = std::sin(3.141592653589793 / 4) * ring.radius;
            start          = *editor::project(editor::point(ring.basis, a), camera, size);
            end            = *editor::project(editor::point(ring.basis, b), camera, size);
            auto rotated   = editor::updateDrag(*editor::beginDrag(ring, k, start), end);
            close(std::abs(rotated["rotation"][k].get<double>()), std::sin(3.141592653589793 / 8));
        }
        for (double pitch : {0., 90., -90.})
        {
            editor::Camera ortho{0, pitch, 8, true};
            editor::Size   dims{960, 640};
            editor::V3     point{.4, .3, -.2};
            auto           screen = editor::project(point, ortho, dims);
            if (!screen)
                throw std::runtime_error("Orthographic projection clipped visible point");
            auto ray = editor::rayAt(*screen, ortho, dims);
            auto hit = editor::add(
              ray.origin, editor::times(ray.direction, editor::dot(editor::sub(point, ray.origin), ray.direction)));
            for (int k = 0; k < 3; k++)
                close(hit[k], point[k]);
            auto other = editor::rayAt({100, 200}, ortho, dims);
            for (int k = 0; k < 3; k++)
                close(other.direction[k], ray.direction[k]);
        }
        for (bool orthographic : {false, true})
        {
            editor::Camera camera{25, 20, 8, orthographic, {7, 4, -3}};
            editor::Size   size{900, 600};
            auto           center = *editor::project(camera.target, camera, size);
            close(center.x, 450);
            close(center.y, 300);
            auto pan   = editor::panCamera(camera, 80, -30, size);
            auto moved = *editor::project(camera.target, pan, size);
            close(moved.x - center.x, 80);
            close(moved.y - center.y, -30);
            auto framed = editor::frameBounds(camera, editor::Bounds{{-2, 0, -1}, {3, 3, 1}}, size);
            for (auto p : editor::boundsCorners({{-2, 0, -1}, {3, 3, 1}}))
            {
                auto q = editor::project(p, framed, size);
                if (!q || q->x < 0 || q->x > 900 || q->y < 0 || q->y > 600)
                    throw std::runtime_error("Frame bounds clipped a corner");
            }
        }
        {
            const editor::Bounds b{{-.5, -1, -.5}, {.5, 2, .5}};
            editor::Size         size{900, 600};
            for (bool ortho : {false, true})
            {
                editor::Camera c{25, 35, 8, ortho};
                auto           p = editor::project({1.24, 0, -2.26}, c, size);
                auto           t = editor::placementAt(*p, c, size, b, true, .5);
                if (!t)
                    throw std::runtime_error("Placement ray rejected");
                close((*t)["position"][0], 1);
                close((*t)["position"][1], 1);
                close((*t)["position"][2], -2.5);
            }
            if (editor::placementAt({450, 300}, {0, 0, 8, true}, size, b))
                throw std::runtime_error("Parallel placement accepted");
            auto                fixture = editor::read(root / "placement.scene.json");
            editor::AssetBounds bounds{{"asset", b}};
            for (const std::string id : {"group", "mesh"})
            {
                auto s      = fixture;
                auto before = editor::worldMatrices(s).at("mesh");
                auto t      = editor::groundedTransform(s, id, bounds);
                if (!t)
                    throw std::runtime_error("Ground transform rejected");
                for (auto& n : s["nodes"])
                    if (n["id"] == id)
                        n["transform"] = *t;
                auto   after = editor::worldMatrices(s).at("mesh");
                double min   = 1e20;
                for (auto p : editor::boundsCorners(b))
                    min = std::min(min, editor::point(after, p)[1]);
                close(min, 0);
                for (int k = 0; k < 16; k++)
                    if (k != 13)
                        close(after[k], before[k]);
            }
            fixture["nodes"][0]["transform"]["scale"][1] = 0;
            if (editor::groundedTransform(fixture, "mesh", bounds))
                throw std::runtime_error("Singular parent was grounded");
        }
        editor::History transaction;
        transaction.replace(valid);
        transaction.beginPreview();
        for (int i = 1; i <= 50; ++i)
        {
            auto draft                                    = valid;
            draft["nodes"][0]["transform"]["position"][0] = i;
            transaction.preview(draft);
        }
        transaction.finishPreview();
        if (transaction.past.size() != 1)
            throw std::runtime_error("Drag must create one undo");
        transaction.undo();
        if (transaction.scene != valid || !transaction.past.empty())
            throw std::runtime_error("Drag undo mismatch");
        transaction.beginPreview();
        auto draft                                 = valid;
        draft["nodes"][0]["transform"]["scale"][0] = 7;
        transaction.preview(draft);
        transaction.cancelPreview();
        if (transaction.scene != valid || transaction.future.empty())
            throw std::runtime_error("Cancel corrupted history");
        std::cout << "Native scene, gizmo axes/rings, parent transforms, drag transactions and persistence passed\n";
        return 0;
    }
    catch (const std::exception& e)
    {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
