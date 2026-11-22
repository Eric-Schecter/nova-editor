import { readGLB, writeGLB } from "./index";
import { decodeModel } from "./model";
import { validateScene, type Scene } from "../scene-schema/index";

// Keep ancestor transforms as empty nodes when exporting a subtree. Assets are
// merged once, so repeated scene instances retain shared meshes/materials.
export function exportGLB(
  scene: Scene,
  load: (path: string) => Uint8Array,
  selection?: string[],
): Uint8Array {
  validateScene(scene);
  const content = new Set<string>();
  if (selection) {
    if (
      !selection.length ||
      selection.some((id) => !scene.nodes.some((n) => n.id === id))
    )
      throw Error("请选择有效对象");
    selection.forEach((id) => content.add(id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of scene.nodes)
        if (n.parentId && content.has(n.parentId) && !content.has(n.id)) {
          content.add(n.id);
          changed = true;
        }
    }
  } else scene.nodes.forEach((n) => content.add(n.id));
  const included = new Set(content);
  for (const id of content) {
    let n = scene.nodes.find((n) => n.id === id)!;
    while (n.parentId) {
      included.add(n.parentId);
      n = scene.nodes.find((p) => p.id === n.parentId)!;
    }
  }
  const j: any = {
    asset: { version: "2.0", generator: "Nova Editor" },
    scene: 0,
    scenes: [{ name: scene.name, nodes: [] }],
    nodes: [],
    skins: [],
    animations: [],
    buffers: [{ byteLength: 0 }],
  };
  const keys = [
    "bufferViews",
    "accessors",
    "images",
    "samplers",
    "textures",
    "materials",
    "meshes",
    "cameras",
  ];
  keys.forEach((k) => (j[k] = []));
  const chunks: Uint8Array[] = [];
  let length = 0;
  const assetGraphs = new Map<string, {
    start: number;
    end: number;
    roots: number[];
    skins: any[];
    animations: any[];
  }>();
  const used = new Set<string>(),
    required = new Set<string>();
  function merge(id: string) {
    const a = scene.assets[id],
      doc = readGLB(load(a.path)),
      s = structuredClone(doc.json);
    if (doc.extra.length) throw Error("暂不支持导出自定义 GLB 数据块");
    const allowed =
      /^(KHR_materials_|KHR_texture_transform$|KHR_mesh_quantization$)/;
    for (const ext of s.extensionsUsed ?? []) {
      if (!allowed.test(ext) || ext === "KHR_materials_variants")
        throw Error("不支持的 GLB 扩展：" + ext);
      used.add(ext);
    }
    for (const ext of s.extensionsRequired ?? []) {
      if (!(s.extensionsUsed ?? []).includes(ext)) throw Error("无效扩展声明");
      required.add(ext);
    }
    const base: any = Object.fromEntries(keys.map((k) => [k, j[k].length]));
    base.nodes = j.nodes.length;
    const offset = Math.ceil(length / 4) * 4;
    if (offset + doc.bin.length > 128 * 1024 * 1024)
      throw Error("GLB 超过 128 MiB");
    chunks.push(new Uint8Array(offset - length), doc.bin);
    length = offset + doc.bin.length;
    for (const v of s.bufferViews ?? []) {
      if (v.buffer !== 0 || (v.byteOffset ?? 0) + v.byteLength > doc.bin.length)
        throw Error("GLB 缓冲越界");
      v.buffer = 0;
      v.byteOffset = (v.byteOffset ?? 0) + offset;
    }
    const remapView = (o: any) => {
      if (o.bufferView !== undefined) o.bufferView += base.bufferViews;
    };
    for (const a of s.accessors ?? []) {
      remapView(a);
      if (a.sparse) {
        remapView(a.sparse.indices);
        remapView(a.sparse.values);
      }
    }
    for (const img of s.images ?? []) {
      if (img.uri || img.bufferView === undefined)
        throw Error("导出需要内嵌贴图");
      remapView(img);
    }
    for (const t of s.textures ?? []) {
      if (t.source !== undefined) t.source += base.images;
      if (t.sampler !== undefined) t.sampler += base.samplers;
    }
    function materialTextures(o: any) {
      for (const [k, v] of Object.entries(o))
        if (v && typeof v === "object") {
          if (k.endsWith("Texture") && Number.isInteger((v as any).index))
            (v as any).index += base.textures;
          else materialTextures(v);
        }
    }
    for (const m of s.materials ?? []) materialTextures(m);
    for (const m of s.meshes ?? [])
      for (const p of m.primitives) {
        for (const k of Object.keys(p.attributes))
          p.attributes[k] += base.accessors;
        if (p.indices !== undefined) p.indices += base.accessors;
        if (p.material !== undefined) p.material += base.materials;
        for (const target of p.targets ?? [])
          for (const k of Object.keys(target)) target[k] += base.accessors;
      }
    for (const n of s.nodes ?? []) {
      if (n.mesh !== undefined) n.mesh += base.meshes;
      if (n.camera !== undefined) n.camera += base.cameras;
      if (n.children)
        n.children = n.children.map((x: number) => x + base.nodes);
    }
    for (const k of keys) j[k].push(...(s[k] ?? []));
    j.nodes.push(...(s.nodes ?? []));
    const roots = (s.scenes?.[s.scene ?? 0]?.nodes ?? []).map(
      (n: number) => n + base.nodes,
    );
    if (!s.scenes?.length && s.nodes?.length) throw Error("GLB 缺少默认场景");
    const skins = s.skins ?? [];
    const animations = s.animations ?? [];
    for (const skin of skins)
      if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices += base.accessors;
    for (const animation of animations)
      for (const sampler of animation.samplers) {
        sampler.input += base.accessors;
        sampler.output += base.accessors;
      }
    assetGraphs.set(id, { roots, start: base.nodes, end: j.nodes.length, skins, animations });
  }
  for (const n of scene.nodes)
    if (content.has(n.id) && n.assetId && !assetGraphs.has(n.assetId))
      merge(n.assetId);
  const indexes = new Map<string, number>();
  for (const n of scene.nodes)
    if (included.has(n.id)) {
      indexes.set(n.id, j.nodes.length);
      j.nodes.push({
        name: n.name,
        translation: [...n.transform.position],
        rotation: [...n.transform.rotation],
        scale: [...n.transform.scale],
        extras: {
          novaEditor: { id: n.id, hidden: !!n.hidden, locked: !!n.locked },
        },
        children: [],
      });
    }
  for (const n of scene.nodes)
    if (included.has(n.id)) {
      const index = indexes.get(n.id)!,
        out = j.nodes[index];
      if (n.parentId && indexes.has(n.parentId))
        j.nodes[indexes.get(n.parentId)!].children.push(index);
      else j.scenes[0].nodes.push(index);
      if (!content.has(n.id)) continue;
      if (n.camera) {
        const c = n.camera;
        out.camera = j.cameras.length;
        j.cameras.push(
          c.projection === "orthographic"
            ? {
                type: "orthographic",
                orthographic: {
                  xmag: c.orthographicSize / 2,
                  ymag: c.orthographicSize / 2,
                  znear: c.nearPlane ?? 0.01,
                  zfar: c.farPlane ?? 200,
                },
              }
            : {
                type: "perspective",
                perspective: {
                  yfov: ((c.verticalFov ?? 45) * Math.PI) / 180,
                  znear: c.nearPlane ?? 0.01,
                  zfar: c.farPlane ?? 200,
                },
              },
        );
      }
      if (n.light) {
        const l = n.light;
        used.add("KHR_lights_punctual");
        j.extensions ??= {};
        j.extensions.KHR_lights_punctual ??= { lights: [] };
        const lights = j.extensions.KHR_lights_punctual.lights;
        out.extensions = { KHR_lights_punctual: { light: lights.length } };
        const lamp: any = {
          name: n.name,
          type: l.type,
          color: l.color,
          intensity: l.active ? l.intensity : 0,
          extras: { novaEditor: l },
        };
        if (l.range) lamp.range = l.range;
        if (l.type === "spot")
          lamp.spot = {
            innerConeAngle: l.innerConeAngle ?? 0.35,
            outerConeAngle: l.outerConeAngle ?? 0.6,
          };
        lights.push(lamp);
      }
      if (n.assetId) {
        const graph = assetGraphs.get(n.assetId)!,
          delta = j.nodes.length - graph.start;
        const instanceStart = j.nodes.length;
        const skinBase = j.skins.length;
        const instanceNode = (index: number) => {
          if (!Number.isInteger(index) || index < 0 || index >= graph.end - graph.start)
            throw Error("无效的动画或蒙皮节点引用");
          return instanceStart + index;
        };
        const copied = j.nodes.slice(graph.start, graph.end).map((v: any) => {
          const c = structuredClone(v);
          if (c.children) c.children = c.children.map((x: number) => instanceNode(x - graph.start));
          if (c.skin !== undefined) {
            if (!Number.isInteger(c.skin) || c.skin < 0 || c.skin >= graph.skins.length)
              throw Error("无效的蒙皮引用");
            c.skin += skinBase;
          }
          return c;
        });
        j.nodes.push(...copied);
        for (const source of graph.skins) {
          const skin = structuredClone(source);
          skin.joints = skin.joints.map(instanceNode);
          if (skin.skeleton !== undefined) skin.skeleton = instanceNode(skin.skeleton);
          j.skins.push(skin);
        }
        for (const source of graph.animations) {
          const animation = structuredClone(source);
          for (const channel of animation.channels)
            channel.target.node = instanceNode(channel.target.node);
          j.animations.push(animation);
        }
        let roots = graph.roots.map((x) => x + delta);
        if (!scene.assets[n.assetId].sourceSpace) {
          const t = decodeModel(
            load(scene.assets[n.assetId].path),
          ).normalization;
          const i = j.nodes.length;
          j.nodes.push({
            name: "Source normalization",
            translation: t.position,
            rotation: t.rotation,
            scale: t.scale,
            children: roots,
          });
          roots = [i];
        }
        out.children.push(...roots);
      }
    }
  // Source template nodes are unreachable and removed, preserving only instances.
  const templates = new Set<number>();
  for (const g of assetGraphs.values())
    for (let i = g.start; i < g.end; i++) templates.add(i);
  const map = new Map<number, number>();
  j.nodes.forEach((_: any, i: number) => {
    if (!templates.has(i)) map.set(i, map.size);
  });
  j.nodes = j.nodes.filter((_: any, i: number) => map.has(i));
  for (const n of j.nodes)
    if (n.children) n.children = n.children.map((i: number) => map.get(i));
  for (const skin of j.skins) {
    skin.joints = skin.joints.map((i: number) => map.get(i));
    if (skin.skeleton !== undefined) skin.skeleton = map.get(skin.skeleton);
  }
  for (const animation of j.animations)
    for (const channel of animation.channels)
      channel.target.node = map.get(channel.target.node);
  if (!j.skins.length) delete j.skins;
  if (!j.animations.length) delete j.animations;
  j.scenes[0].nodes = j.scenes[0].nodes.map((i: number) => map.get(i));
  for (const n of j.nodes) if (!n.children?.length) delete n.children;
  if (used.size) j.extensionsUsed = [...used].sort();
  if (required.size) j.extensionsRequired = [...required].sort();
  j.buffers[0].byteLength = length;
  for (const k of keys) if (!j[k].length) delete j[k];
  if (!length) delete j.buffers;
  const bin = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    bin.set(c, at);
    at += c.length;
  }
  return writeGLB({ json: j, bin, extra: [] });
}
