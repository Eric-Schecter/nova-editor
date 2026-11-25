# Native Nova Editor

The first mobile build supports one GLB at a time. Use **Import GLB** to choose a file, tap the model to select it, and use **Save** and **Open** for the local scene. Save replaces the app's previous mobile scene. The saved JSON and a copy of its GLB live in app storage. The bottom bar opens the Scene, Properties, and Assets drawers. Select the model in the viewport or Scene drawer to inspect its name and type.

## iOS Simulator

On an Apple Silicon Mac with Xcode and a matching iOS simulator runtime:

```sh
node tools/sdk/mobile.mjs ios-simulator-arm64
cmake -S apps/mobile -B build/mobile-ios-sim \
  -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT=iphonesimulator \
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_BUILD_TYPE=Release
cmake --build build/mobile-ios-sim --parallel
xcrun simctl install booted build/mobile-ios-sim/NovaEditor.app
xcrun simctl launch booted org.nova.editor.mobile
```

For an ARM64 device build, install `ios-arm64`, configure with `iphoneos`, and sign the resulting app for the device.

## Android

Use an ARM64 Vulkan-capable Android emulator or device. Install NDK 27, Android API 35, Build Tools 35.0.0 and a JDK. Set `ANDROID_HOME`, `ANDROID_NDK_HOME`, `JAVA_HOME` and `SDL3_SOURCE_DIR` to the matching SDL3 source (3.2.28 for the Nova 0.10.28 Android package).

```sh
node tools/sdk/mobile.mjs android-arm64
cmake -S apps/mobile -B build/mobile-android \
  -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 \
  -DANDROID_STL=c++_static -DCMAKE_BUILD_TYPE=Release
cmake --build build/mobile-android --parallel
apps/mobile/android/package.sh build/mobile-android
adb install -r build/mobile-android/nova-editor-debug.apk
adb shell am start -n org.nova.editor.mobile/.NovaActivity
```

Both platforms use the SDK version and checksums in the root lockfile. The installer also accepts a local paired release directory as its second argument. It verifies the same manifest and package checksums before extracting to `deps/nova/mobile/`.
