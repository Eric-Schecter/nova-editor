import { cp, mkdir } from "node:fs/promises";
await mkdir("apps/web/public/environments", { recursive: true });
await cp("resources/environments", "apps/web/public/environments", {
  recursive: true,
});
