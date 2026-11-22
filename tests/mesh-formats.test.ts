import {test} from "node:test";
import assert from "node:assert/strict";
import {glbToMesh, meshToGLB} from "../packages/asset-system/mesh-formats";
import {readGLB,writeGLB} from "../packages/asset-system/index";
import {decodeModel} from "../packages/asset-system/model";

test("negative indices and concave OBJ faces triangulate and reopen through STL", () => {
  const obj = new TextEncoder().encode("v 0 0 0\nv 2 0 0\nv 2 2 0\nv 1 1 0\nv 0 2 0\nf -5 -4 -3 -2 -1\n");
  const glb = meshToGLB(obj, "obj");
  assert.equal(readGLB(glb).json.accessors[0].count, 9);
  assert.equal(decodeModel(glb).parts.length, 1);
  const stl = glbToMesh(glb, "stl");
  assert.equal(stl.length, 84 + 3 * 50);
  assert.deepEqual(glbToMesh(meshToGLB(stl, "stl"), "stl"), stl);
});
test("ASCII STL imports and export applies parent transform and mirrored winding", () => {
  const source = new TextEncoder().encode("solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n");
  const doc = readGLB(meshToGLB(source, "stl"));
  doc.json.nodes.push({children:[0],translation:[3,0,0],scale:[-1,1,1]});
  doc.json.scenes[0].nodes=[1];
  const obj = new TextDecoder().decode(glbToMesh(writeGLB(doc), "obj"));
  assert.match(obj, /v 3 0 0\nv 3 1 0\nv 2 0 0\nf 1 2 3/);
  assert.throws(() => meshToGLB(new TextEncoder().encode("v 0 0 0\nf 1 2 3"), "obj"), /索引/);
});
