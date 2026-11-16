import {
  emptyScene,
  validateScene,
  type Scene,
} from "../../scene-schema/index";
export class EditorHistory {
  #scene: Scene;
  #past: Scene[] = [];
  #future: Scene[] = [];
  #previewBase: Scene | null = null;
  get isPreviewing() {
    return this.#previewBase !== null;
  }
  beginPreview() {
    this.cancelPreview();
    this.#previewBase = this.scene;
  }
  preview(edit: (draft: Scene) => void) {
    if (!this.#previewBase) throw Error("No active preview");
    const draft = structuredClone(this.#previewBase);
    edit(draft);
    this.#scene = validateScene(draft);
  }
  finishPreview() {
    if (!this.#previewBase) return;
    const base = this.#previewBase;
    this.#previewBase = null;
    if (JSON.stringify(base) !== JSON.stringify(this.#scene)) {
      this.#past.push(base);
      if (this.#past.length > 100) this.#past.shift();
      this.#future = [];
    }
  }
  cancelPreview() {
    if (this.#previewBase) {
      this.#scene = this.#previewBase;
      this.#previewBase = null;
    }
  }
  constructor(scene = emptyScene()) {
    this.#scene = validateScene(scene);
  }
  get scene() {
    return structuredClone(this.#scene);
  }
  get canUndo() {
    return this.#past.length > 0;
  }
  get canRedo() {
    return this.#future.length > 0;
  }
  commit(edit: (draft: Scene) => void) {
    this.cancelPreview();
    const draft = this.scene;
    edit(draft);
    const next = validateScene(draft);
    if (JSON.stringify(next) === JSON.stringify(this.#scene)) return;
    this.#past.push(this.#scene);
    if (this.#past.length > 100) this.#past.shift();
    this.#scene = next;
    this.#future = [];
  }
  undo() {
    this.cancelPreview();
    if (this.canUndo) {
      this.#future.push(this.#scene);
      this.#scene = this.#past.pop()!;
    }
  }
  redo() {
    this.cancelPreview();
    if (this.canRedo) {
      this.#past.push(this.#scene);
      this.#scene = this.#future.pop()!;
    }
  }
  replace(scene: Scene) {
    this.cancelPreview();
    this.#scene = validateScene(scene);
    this.#past = [];
    this.#future = [];
  }
}
export function removeSubtree(scene: Scene, id: string) {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of scene.nodes)
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id);
        changed = true;
      }
  }
  scene.nodes = scene.nodes.filter((n) => !ids.has(n.id));
}
