import { updateRelease, readLock } from "./install.mjs";
import { checkUpdates } from "./download.mjs";
try {
  const args = process.argv.slice(2);
  if (args.length !== 1)
    throw Error(
      "Usage: sdk:update <exact-version> | --check (checking never installs)",
    );
  if (args[0] === "--check") {
    const lock = await readLock(process.cwd()),
      result = await checkUpdates(lock?.version ?? null);
    console.log(
      `Locked: ${result.current ?? "none"}; latest compatible published release: ${result.latest ?? "none"}. No files changed.`,
    );
    if (result.latest && result.latest !== result.current)
      console.log(
        `Review package/platform support, then run: pnpm sdk:update ${result.latest}`,
      );
  } else await updateRelease(process.cwd(), args[0]);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
