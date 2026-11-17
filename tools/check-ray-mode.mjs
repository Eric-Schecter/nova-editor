import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { decode } from "./testing/png.mjs";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu"],
});
mkdirSync("output/ray-mode-browser", { recursive: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1500, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(process.env.NOVA_EDITOR_URL || "http://127.0.0.1:5223");
  await page
    .locator('input[accept=".zip"]')
    .setInputFiles(resolve("output/lights-browser/project.zip"));
  const ready = async () => {
    await page.waitForTimeout(150);
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".viewport-footer")
          ?.textContent?.includes("正在加载"),
      undefined,
      { timeout: 120000 },
    );
    assert(
      !((await page.locator("footer").textContent()) || "").includes("失败"),
    );
  };
  await ready();
  const shot = async (name) => {
    await ready();
    return decode(
      await page
        .locator("canvas")
        .screenshot({ path: "output/ray-mode-browser/" + name + ".png" }),
    );
  };
  const diff = (a, b) => {
    let sum = 0;
    assert.equal(a.pixels.length, b.pixels.length);
    for (let i = 0; i < a.pixels.length; i++)
      sum += Math.abs(a.pixels[i] - b.pixels[i]);
    return sum / a.pixels.length;
  };
  const raster = await shot("raster");
  await page
    .getByLabel("渲染模式", { exact: true })
    .selectOption("ray-tracing");
  await ready();
  assert.equal(
    await page.getByLabel("渲染模式", { exact: true }).inputValue(),
    "ray-tracing",
  );
  const ray = await shot("ray");
  assert(diff(raster, ray) > 0.1, "Mode switch did not change pixels");
  await page.getByRole("treeitem").filter({ hasText: "Point light" }).click();
  await page.getByLabel("节点灯光强度", { exact: true }).fill("0");
  await page.getByRole("button", { name: "应用节点设置", exact: true }).click();
  await ready();
  assert.equal(
    await page.getByLabel("渲染模式", { exact: true }).inputValue(),
    "ray-tracing",
  );
  await shot("point-off");
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await ready();
  assert.equal(
    await page.getByLabel("节点灯光强度", { exact: true }).inputValue(),
    "12",
  );
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Mesh · 1 · Left" })
    .click();
  await page.getByRole("tab", { name: "材质", exact: true }).click();
  await page.getByLabel("材质基础色十六进制").fill("#00ff00");
  await page.getByRole("button", { name: "应用材质", exact: true }).click();
  await ready();
  const material = await shot("ray-material");
  let green = 0,
    blue = 0;
  for (let i = 0; i < material.pixels.length; i += material.channels) {
    const p = material.pixels;
    if (p[i + 1] > 80 && p[i + 1] > p[i] * 1.4 && p[i + 1] > p[i + 2] * 1.4)
      green++;
    if (p[i + 2] > 80 && p[i + 2] > p[i] * 1.4 && p[i + 2] > p[i + 1] * 1.4)
      blue++;
  }
  assert(
    green > 100 && blue > 100,
    "Ray material update lost independent instance colors",
  );
  assert.equal(
    await page.getByLabel("渲染模式", { exact: true }).inputValue(),
    "ray-tracing",
  );
  await page.getByLabel("渲染模式", { exact: true }).selectOption("raster");
  await ready();
  await shot("raster-restored");
  assert.deepEqual(errors, []);
  console.log(
    "PASS editor ray mode: instance scene, PBR pixels, light edit/undo, independent material update and raster return",
  );
} finally {
  await browser.close();
}
