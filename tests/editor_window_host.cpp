#define NOVA_EDITOR_TEST
#include "../apps/desktop/src/main.cpp"
#include <SDL3/SDL.h>

namespace
{
    void require(bool condition, const char* message)
    {
        if (!condition)
            throw std::runtime_error(message);
    }
} // namespace

int main(int argc, char** argv)
{
    try
    {
        render::WindowConfig config;
        config.width  = 640;
        config.height = 480;
        config.title  = "Nova Editor window smoke";
        if (argc > 1 && std::string_view(argv[1]) == "vulkan")
            config.renderer.api = render::GraphicsAPI::Vulkan;
        editor::RenderWindow window(config);
        Editor               editor;
        editor.window = &window;
        editor.history.replace(editor::emptyScene());
        editor.saved = editor.history.scene;

        bool                         confirmationDrawn = false;
        render::ParameterPanelConfig panel;
        panel.showBuiltinPanel = false;
        panel.drawUI           = [&] {
            editor.drawDialogs();
            confirmationDrawn = ImGui::IsPopupOpen("Unsaved changes");
        };
        require(window.EnableParameterPanel(panel), "Editor needs parameter UI support");
        require(window.PollEvents() && window.DrawFrame() == render::FrameResult::Rendered, "Initial frame failed");

        int          count   = 0;
        SDL_Window** windows = SDL_GetWindows(&count);
        SDL_Window*  host    = count == 1 && windows ? windows[0] : nullptr;
        SDL_free(windows);
        require(host, "Editor did not create an SDL window");

        const auto initial = window.GetFramebufferSize();
        window.SetSize(800, 540);
        require(SDL_SyncWindow(host), SDL_GetError());
        require(window.PollEvents() && window.GetFramebufferSize() != initial, "Editor framebuffer did not resize");
        require(window.DrawFrame() == render::FrameResult::Rendered, "Frame after resizing failed");

        editor.history.scene["name"] = "Unsaved edit";
        SDL_Event close{};
        close.type            = SDL_EVENT_WINDOW_CLOSE_REQUESTED;
        close.window.windowID = SDL_GetWindowID(host);
        require(SDL_PushEvent(&close) && !window.PollEvents(), "Editor did not receive the SDL close request");
        require(editor.continueAfterClose(window) && window.PollEvents(), "Unsaved edits did not keep the window open");
        require(
          window.DrawFrame() == render::FrameResult::Rendered && confirmationDrawn && editor.dirty(),
          "Unsaved close confirmation was not rendered");
        editor.finishRequest(false);
        require(editor.exitApproved, "Discard did not approve closing the editor");

        window.WaitIdle();
        require(window.ValidationErrorCount() == 0, "GPU validation errors during window tests");
        std::cout << "Editor rendered, resized, displayed unsaved close confirmation and accepted discard.\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
