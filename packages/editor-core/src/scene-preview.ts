import type { Scene } from "../../scene-schema/index";
import { worldMatrices } from "../../scene-schema/transforms";

/** Runtime transforms are derived from the authored pose, never written into history. */
export function previewWorldMatrices(scene: Scene, seconds: number) {
  return worldMatrices({
    ...scene,
    nodes: scene.nodes.map((node) => {
      const behavior = node.previewBehavior;
      if (!behavior) return node;
      const transform = { ...node.transform };
      if (behavior.kind === "bob") {
        transform.position = [...transform.position];
        transform.position[1] += Math.sin(seconds * Math.PI * 2) * behavior.amount;
      } else {
        const half = (seconds * behavior.amount * Math.PI) / 360;
        const [x, y, z, w] = transform.rotation;
        const s = Math.sin(half), c = Math.cos(half);
        transform.rotation = [x*c-z*s, y*c+w*s, z*c+x*s, w*c-y*s];
      }
      return { ...node, transform };
    }),
  });
}
