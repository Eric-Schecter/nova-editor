import { cameraFrame, dot, sub, type Camera, type Point } from "./viewport";
export const standardViews = [
  { label: "前", title: "前视图 (+Z)", yaw: 0, pitch: 0, axis: 2, sign: 1 },
  { label: "后", title: "后视图 (-Z)", yaw: 180, pitch: 0, axis: 2, sign: -1 },
  { label: "左", title: "左视图 (-X)", yaw: -90, pitch: 0, axis: 0, sign: -1 },
  { label: "右", title: "右视图 (+X)", yaw: 90, pitch: 0, axis: 0, sign: 1 },
  { label: "顶", title: "顶视图 (+Y)", yaw: 0, pitch: 90, axis: 1, sign: 1 },
  {
    label: "底",
    title: "底视图 (-Y)",
    yaw: 0,
    pitch: -90,
    axis: 1,
    sign: -1,
  },
] as const;
export function cubeFaces(camera: Camera) {
  const f = cameraFrame(camera);
  return standardViews.flatMap((view) => {
    const n = [0, 0, 0];
    n[view.axis] = view.sign;
    if (
      dot(n, sub(f.eye, camera.target ?? [0, 0, 0])) <=
      camera.distance * 0.02
    )
      return [];
    const u = (view.axis + 1) % 3,
      v = (view.axis + 2) % 3;
    const points: Point[] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([a, b]) => {
      const p = [0, 0, 0];
      p[view.axis] = view.sign;
      p[u] = a;
      p[v] = b;
      return { x: 60 + dot(p, f.right) * 23, y: 52 - dot(p, f.up) * 23 };
    });
    return [
      {
        ...view,
        points,
        center: {
          x: points.reduce((s, p) => s + p.x, 0) / 4,
          y: points.reduce((s, p) => s + p.y, 0) / 4,
        },
      },
    ];
  });
}
