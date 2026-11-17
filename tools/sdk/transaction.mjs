import {
  mkdir,
  readFile,
  writeFile,
  rm,
  rename,
  access,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { layout, stateRoot, sdkTargets, legacyTargets } from "./paths.mjs";
async function writeJournal(path, state) {
  const temp = path + ".tmp";
  await writeFile(temp, JSON.stringify(state));
  await rename(temp, path);
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
const targetsFor = (kind) => {
  if (kind === "sdk") return sdkTargets;
  if (kind === "web") return [layout.webPublic];
  throw Error("Invalid SDK transaction kind");
};
async function recoverJournal(root, journal, base, legacy = false) {
  let state;
  try {
    state = JSON.parse(await readFile(journal, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  const targets = legacy ? legacyTargets : targetsFor(state.kind ?? "sdk");
  if (
    !/^[a-f0-9-]{36}$/.test(state.id) ||
    !Array.isArray(state.hadOriginal) ||
    state.hadOriginal.length !== targets.length ||
    !state.hadOriginal.every((v) => typeof v === "boolean") ||
    typeof state.committed !== "boolean"
  )
    throw Error("Invalid SDK recovery journal");
  const work = join(root, base, "transactions", state.id);
  if (!state.committed)
    for (let i = targets.length - 1; i >= 0; i--) {
      const target = join(root, targets[i]),
        old = join(work, "old-" + i),
        prepared = join(work, "new-" + i);
      if (await exists(old)) {
        await rm(target, { recursive: true, force: true });
        await rename(old, target);
      } else if (!state.hadOriginal[i] && !(await exists(prepared)))
        await rm(target, { recursive: true, force: true });
    }
  await rm(journal, { force: true });
  await rm(work, { recursive: true, force: true });
}
export async function recoverInstall(root) {
  await recoverJournal(
    root,
    join(root, ".sdk/install-state.json"),
    ".sdk",
    true,
  );
  await recoverJournal(
    root,
    join(root, stateRoot, "install-state.json"),
    stateRoot,
  );
}
export async function replaceInstall(
  root,
  work,
  { renameFile = rename, kind = "sdk" } = {},
) {
  root = resolve(root);
  const targets = targetsFor(kind),
    id = work.split(/[\\/]/).at(-1),
    journal = join(root, stateRoot, "install-state.json");
  const state = {
    id,
    kind,
    hadOriginal: await Promise.all(targets.map((p) => exists(join(root, p)))),
    committed: false,
  };
  for (const target of targets)
    await mkdir(dirname(join(root, target)), { recursive: true });
  await writeJournal(journal, state);
  try {
    for (let i = 0; i < targets.length; i++) {
      const target = join(root, targets[i]);
      if (state.hadOriginal[i])
        await renameFile(target, join(work, "old-" + i));
      await renameFile(join(work, "new-" + i), target);
    }
    await writeJournal(journal, { ...state, committed: true });
  } catch (error) {
    await recoverInstall(root);
    throw error;
  }
  await recoverInstall(root);
}
async function ownerActive(path) {
  let pid;
  try {
    pid = Number(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw Error("Invalid SDK installer lock: " + path);
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === "EPERM") return true;
    if (e.code === "ESRCH") return false;
    throw e;
  }
}
export async function withInstallLock(root, action) {
  const lock = join(root, stateRoot, "install.lock");
  await mkdir(join(root, stateRoot), { recursive: true });
  try {
    await writeFile(lock, String(process.pid), { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (await ownerActive(lock)) throw Error("Another SDK install is running");
    await rm(lock);
    return withInstallLock(root, action);
  }
  try {
    if (await ownerActive(join(root, ".sdk/install.lock")))
      throw Error("Another legacy SDK install is running");
    await recoverInstall(root);
    return await action();
  } finally {
    await rm(lock, { force: true });
  }
}
