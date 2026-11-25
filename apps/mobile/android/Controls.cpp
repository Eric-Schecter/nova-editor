#include "../Platform.hpp"
#include <SDL3/SDL.h>
#include <jni.h>

namespace
{
    std::string fromJava(JNIEnv* env, jstring value)
    {
        // JNI's modified UTF-8 encodes supplementary characters as surrogate pairs.
        const auto* chars = env->GetStringChars(value, nullptr);
        if (!chars) return {};
        char* utf8 = SDL_iconv_string("UTF-8", "UTF-16LE", reinterpret_cast<const char*>(chars),
                                    size_t(env->GetStringLength(value)) * sizeof(jchar));
        env->ReleaseStringChars(value, chars);
        std::string result = utf8 ? utf8 : "";
        SDL_free(utf8);
        return result;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_org_nova_editor_mobile_NovaActivity_submitImport(JNIEnv* env, jobject, jstring path, jstring name)
{
    enqueue(Action::Import, fromJava(env, path), fromJava(env, name));
}

extern "C" JNIEXPORT void JNICALL
Java_org_nova_editor_mobile_NovaActivity_saveProject(JNIEnv*, jobject) { enqueue(Action::Save); }

extern "C" JNIEXPORT void JNICALL
Java_org_nova_editor_mobile_NovaActivity_openProject(JNIEnv*, jobject) { enqueue(Action::Open); }

void installControls() {}

void showStatus(const std::string& status)
{
    SDL_Log("%s", status.c_str());
    auto* env = static_cast<JNIEnv*>(SDL_GetAndroidJNIEnv());
    auto activity = static_cast<jobject>(SDL_GetAndroidActivity());
    if (!env || !activity) return;
    const auto type = env->GetObjectClass(activity);
    const auto method = env->GetMethodID(type, "showEditorStatus", "(Ljava/lang/String;)V");
    const auto text = env->NewStringUTF(status.c_str());
    if (method && text) env->CallVoidMethod(activity, method, text);
    if (text) env->DeleteLocalRef(text);
    env->DeleteLocalRef(type);
    env->DeleteLocalRef(activity);
}

extern "C" JNIEXPORT void JNICALL
Java_org_nova_editor_mobile_NovaActivity_selectModel(JNIEnv*, jobject) { enqueue(Action::Select); }

void showModel(const std::string& name, bool selected)
{
    auto* env = static_cast<JNIEnv*>(SDL_GetAndroidJNIEnv());
    auto activity = static_cast<jobject>(SDL_GetAndroidActivity());
    if (!env || !activity) return;
    const auto type = env->GetObjectClass(activity);
    const auto method = env->GetMethodID(type, "showEditorModel", "(Ljava/lang/String;Z)V");
    const auto text = env->NewStringUTF(name.c_str());
    if (method && text) env->CallVoidMethod(activity, method, text, jboolean(selected));
    if (text) env->DeleteLocalRef(text);
    env->DeleteLocalRef(type);
    env->DeleteLocalRef(activity);
}
