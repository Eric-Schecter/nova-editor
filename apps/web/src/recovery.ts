import {
  validateRecovery,
  type Recovery,
} from "../../../packages/editor-core/src/project";
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("nova-editor-recovery", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("sessions", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
// Serialize writes and removals so an older autosave can never resurrect discarded data.
let queue: Promise<unknown> = Promise.resolve();
function transaction<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const job = queue
    .catch(() => {})
    .then(async () => {
      const db = await database();
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction("sessions", mode),
          request = fn(tx.objectStore("sessions"));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? Error("恢复存储失败"));
        };
      });
    });
  queue = job;
  return job;
}
export async function listRecoveries() {
  const values = await transaction<Recovery[]>("readonly", (s) => s.getAll());
  return values
    .map((v) => {
      try {
        return validateRecovery(v);
      } catch {
        return null;
      }
    })
    .filter((v): v is Recovery => !!v)
    .sort((a, b) => b.updated - a.updated);
}
export async function writeRecovery(value: Recovery) {
  const v = validateRecovery(value);
  await transaction("readwrite", (s) => s.put(v));
}
export async function removeRecovery(id: string) {
  await transaction("readwrite", (s) => s.delete(id));
}
