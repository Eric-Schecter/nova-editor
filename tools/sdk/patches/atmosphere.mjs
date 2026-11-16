// Extend an isolated Nova source snapshot; never run against an in-use upstream checkout.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const root = process.argv[2];
if (!root) throw Error("Usage: node atmosphere.mjs <isolated Nova source>");
async function edit(path, fn) {
  const file = join(root, path),
    s = await readFile(file, "utf8");
  await writeFile(file, fn(s));
}
function replace(s, a, b) {
  if (!s.includes(a))
    throw Error("Incompatible Nova source: " + a.slice(0, 80));
  return s.replace(a, b);
}
await edit("render/include/render/Model.hpp", (s) =>
  replace(
    s,
    "bool  showBackground      = true;",
    `bool  showBackground      = true;
        // Raster fog: off=0, linear=1, exponential-squared=2; display-linear RGB.
        std::array<float,3> fogColor{.3185468f,.3185468f,.3185468f};
        int fogMode=0;
        float fogNear=10.f, fogFar=50.f, fogDensity=.02f;`,
  ),
);
await edit("render/src/EnvironmentData.cpp", (s) =>
  replace(
    s,
    "    }\n    const EnvironmentData& FallbackEnvironment()",
    `        if(settings.fogMode<0||settings.fogMode>2||!std::isfinite(settings.fogNear)||settings.fogNear<0||!std::isfinite(settings.fogFar)||settings.fogFar<=settings.fogNear||!std::isfinite(settings.fogDensity)||settings.fogDensity<0||settings.fogDensity>1)throw std::invalid_argument("Invalid raster fog settings");
        for(float c:settings.fogColor)if(!std::isfinite(c)||c<0||c>1)throw std::invalid_argument("Invalid fog color");
    }
    const EnvironmentData& FallbackEnvironment()`,
  ),
);
await edit("render/src/ModelData.hpp", (s) =>
  replace(
    replace(
      s,
      "float irradiance[9][4];",
      "float irradiance[9][4];\n        float fogColorMode[4], fogParams[4];",
    ),
    "sizeof(SceneUniforms) == 384",
    "sizeof(SceneUniforms) == 416",
  ),
);
await edit("render/src/ModelData.cpp", (s) =>
  replace(
    s,
    "        result.irradiance[0][3] = 0;",
    `        std::copy(settings.fogColor.begin(),settings.fogColor.end(),result.fogColorMode);
        result.fogColorMode[3]=float(settings.fogMode);
        result.fogParams[0]=settings.fogNear;result.fogParams[1]=settings.fogFar;result.fogParams[2]=settings.fogDensity;
        result.irradiance[0][3] = 0;`,
  ),
);
await edit("render/src/Renderer.cpp", (s) =>
  replace(
    s,
    "impl_->backend->LoadEnvironment(detail::LoadEnvironmentFile(path));",
    "impl_->backend->LoadEnvironment(path.empty()?nullptr:detail::LoadEnvironmentFile(path));",
  ),
);
await edit("render/shaders/model.hlsl", (s) => {
  s = replace(
    s,
    "float4   irradiance[9];",
    "float4   irradiance[9];\n    float4 fogColorMode;\n    float4 fogParams;",
  );
  const functionCode = `float3 applyDisplayFog(float3 color,float3 position) {
    if(fogColorMode.w<.5)return color;
    float depth=max(0,dot(position-eyeExposure.xyz,cameraForward.xyz));
    float amount=fogColorMode.w<1.5?saturate((depth-fogParams.x)/max(.0001,fogParams.y-fogParams.x)):1-exp(-depth*depth*fogParams.z*fogParams.z);
    float3 fog=fogColorMode.rgb;
#if defined(NOVA_WEB_OUTPUT) && !defined(NOVA_RASTER_AA)
    fog=encodeDisplayRGB(fog);
#else
    // AA resolves raw HDR after the raster pass; preserve the terminal display color.
    if(irradiance[0].w>.5)fog=-log(max(1-fog,float3(.00001,.00001,.00001)));
#endif
    return lerp(color,fog,saturate(amount));
}
`;
  s = replace(s, "struct SkyOut\n{", functionCode + "struct SkyOut\n{");
  s = replace(
    s,
    "return float4(base, 1);",
    "return float4(applyDisplayFog(base,input.worldPosition), 1);",
  );
  return s; // Sky remains unfogged; PSMain is patched separately below.
});
// Match PSMain's final return independently from following motion declarations.
await edit("render/shaders/model.hlsl", (s) => {
  const start = s.indexOf("float4 PSMain("),
    at = s.indexOf("return float4(displayRadiance(color), 1);", start);
  if (at < 0) {
    if (!s.slice(start).includes("applyDisplayFog(displayRadiance(color)"))
      throw Error("Missing model fog return");
    return s;
  }
  return (
    s.slice(0, at) +
    s
      .slice(at)
      .replace(
        "return float4(displayRadiance(color), 1);",
        "return float4(applyDisplayFog(displayRadiance(color),input.worldPosition), 1);",
      )
  );
});
await edit("web/src/EnvironmentData.js", (s) => {
  const begin = s.indexOf("export function copyEnvironment"),
    end = s.indexOf("export async function loadEnvironmentFile");
  return (
    s.slice(0, begin) +
    `export function copyEnvironment(value) {
  if(!value||!Number.isFinite(value.rotation)||Math.abs(value.rotation)>180||![value.intensity,value.backgroundIntensity].every(v=>Number.isFinite(v)&&v>=0&&v<=16)||typeof value.showBackground!=='boolean')throw Error('Invalid environment settings');
  const fogMode=value.fogMode??0,fogColor=value.fogColor??[.3185468,.3185468,.3185468],fogNear=value.fogNear??10,fogFar=value.fogFar??50,fogDensity=value.fogDensity??.02;
  if(![0,1,2].includes(fogMode)||!Array.isArray(fogColor)||fogColor.length!==3||!fogColor.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||!Number.isFinite(fogNear)||fogNear<0||!Number.isFinite(fogFar)||fogFar<=fogNear||!Number.isFinite(fogDensity)||fogDensity<0||fogDensity>1)throw Error('Invalid raster fog settings');
  return {...value,fogMode,fogColor:[...fogColor],fogNear,fogFar,fogDensity};
}
` +
    s.slice(end)
  );
});
await edit("web/src/ModelData.js", (s) =>
  replace(
    s,
    "...(environment?.irradiance || new Float32Array(36)),",
    "...(environment?.irradiance || new Float32Array(36)),\n    ...(settings.fogColor??[.3185468,.3185468,.3185468]),settings.fogMode??0,\n    settings.fogNear??10,settings.fogFar??50,settings.fogDensity??.02,0,",
  ),
);
await edit("web/src/ModelView.js", (s) =>
  s
    .replaceAll("new Float32Array(96)", "new Float32Array(104)")
    .replaceAll("minBindingSize: 384", "minBindingSize: 416")
    .replace(
      "cubeTexture(device, next)",
      "cubeTexture(device, next??fallbackEnvironment)",
    )
    .replace(
      "next.backgroundMips || next.mips",
      "next?.backgroundMips || next?.mips || fallbackEnvironment.mips",
    ),
);
await edit("web/src/Nova.js", (s) =>
  replace(
    s,
    "const environment = await loadEnvironmentFile(url)",
    "const environment = url?await loadEnvironmentFile(url):null",
  ),
);
console.log(
  "Applied raster atmosphere / environment-clear extension to isolated SDK",
);
// Preserve the pre-existing path-tracing storage-buffer layout (not a raster fog path).
const modelHeader = await readFile(
  join(root, "render/src/ModelData.hpp"),
  "utf8",
);
const legacy = modelHeader
  .slice(
    modelHeader.indexOf("    struct SceneUniforms"),
    modelHeader.indexOf("    static_assert(sizeof(ModelVertex)"),
  )
  .replace("SceneUniforms", "PathSceneUniforms")
  .replace("        float fogColorMode[4], fogParams[4];\n", "");
await edit("render/src/path/PathTracing.hpp", (s) =>
  replace(
    replace(s, "    struct PathUniforms", legacy + "    struct PathUniforms"),
    "SceneUniforms                          scene{};",
    "PathSceneUniforms                      scene{};",
  ),
);
await edit("render/src/path/PathTracing.cpp", (s) =>
  replace(
    s,
    "params.scene  = scene;",
    "std::memcpy(&params.scene,&scene,sizeof(params.scene));",
  ),
);
await edit("web/src/PathView.js", (s) =>
  replace(
    s,
    "            settings,\n          ),",
    "            settings,\n          ).subarray(0,96),",
  ),
);
// Keep host compiler caches within the isolated build directory.
for (const file of ["Shaders.cmake", "AAShaders.cmake", "PathShaders.cmake"])
  await edit("cmake/" + file, (s) =>
    s.replaceAll(
      ' -c "',
      ' "-fmodules-cache-path=${CMAKE_CURRENT_BINARY_DIR}/metal-module-cache" -c "',
    ),
  );
