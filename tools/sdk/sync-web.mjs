import { mkdir, cp, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { layout, stateRoot } from "./paths.mjs";
import { verify, verifyWebDeployment } from "./verify.mjs";
import { withInstallLock, replaceInstall } from "./transaction.mjs";
export async function syncWeb(root = process.cwd()) {
  return withInstallLock(root, async () => {
    const lock = await verify(root, { deployment: false });
    try {
      await verifyWebDeployment(root, lock);
      return;
    } catch (e) {
      if (
        e.code !== "ENOENT" &&
        !e.message.startsWith("Web SDK deployment differs")
      )
        throw e;
    }
    const work = join(root, stateRoot, "transactions", randomUUID());
    await mkdir(work, { recursive: true });
    try {
      await cp(join(root, layout.web), join(work, "new-0"), {
        recursive: true,
      });
      await replaceInstall(root, work, { kind: "web" });
      await verifyWebDeployment(root, lock);
      console.log("Prepared web deployment from " + layout.web);
    } finally {
      try {
        await access(join(root, stateRoot, "install-state.json"));
      } catch (e) {
        if (e.code === "ENOENT")
          await rm(work, { recursive: true, force: true });
        else throw e;
      }
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  syncWeb().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
