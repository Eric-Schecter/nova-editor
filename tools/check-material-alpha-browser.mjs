import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
const { chromium } = await import(
  process.env.NOVA_PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu"],
});
mkdirSync("output/material-alpha", { recursive: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() =>
    Object.defineProperty(window, "showSaveFilePicker", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto(process.env.NOVA_EDITOR_URL || "http://127.0.0.1:5223");
  await page
    .locator('input[accept=".glb"]')
    .setInputFiles(resolve("tests/fixtures/material-alpha/Layers.glb"));
  await page
    .getByText("4 个模型实例", { exact: true })
    .waitFor({ timeout: 120000 });
  const ready = async () => {
    await page.waitForTimeout(150);
    await page.waitForFunction(() => {
      const t = document.querySelector("footer")?.textContent || "";
      if (t.includes("场景渲染失败")) throw Error(t);
      return !document
        .querySelector(".viewport-footer")
        ?.textContent?.includes("正在加载");
    });
    await page.waitForTimeout(100);
  };
  await ready();
  const select = async (name) => {
    await page.getByRole("treeitem").filter({ hasText: name }).click();
    await page.getByRole("tab", { name: "材质", exact: true }).click();
  };
  await select("Mesh · 2 · BLEND");
  assert.equal(await page.getByLabel("材质 Alpha 模式").inputValue(), "BLEND");
  assert.equal(
    await page.getByLabel("不透明度", { exact: true }).inputValue(),
    "0.45",
  );
  const before = await page.locator("canvas").screenshot();
  await page.getByLabel("不透明度", { exact: true }).fill(".25");
  await page.getByLabel("材质双面").uncheck();
  await page.getByRole("button", { name: "应用材质", exact: true }).click();
  await ready();
  const after = await page
    .locator("canvas")
    .screenshot({ path: "output/material-alpha/blend.png" });
  assert.ok(!before.equals(after), "Alpha edit did not affect rendering");
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(mod + "+z");
  await ready();
  assert.equal(
    await page.getByLabel("不透明度", { exact: true }).inputValue(),
    "0.45",
  );
  await page.keyboard.press(mod + "+Shift+z");
  await ready();
  assert.equal(
    await page.getByLabel("不透明度", { exact: true }).inputValue(),
    "0.25",
  );
  await select("Mesh · 4 · MASK");
  assert.equal(await page.getByLabel("材质 Alpha 模式").inputValue(), "MASK");
  await page.getByLabel("不透明度", { exact: true }).fill(".8");
  await page.getByLabel("Alpha 裁剪阈值", { exact: true }).fill(".65");
  await page.getByLabel("材质双面").uncheck();
  await page.getByRole("button", { name: "应用材质", exact: true }).click();
  await ready();
  await page.screenshot({ path: "output/material-alpha/editor.png" });
  const download = page.waitForEvent("download");
  await page.keyboard.press(mod + "+s");
  const file = await download;
  await file.saveAs(resolve("output/material-alpha/project.zip"));
  const archive = unzipSync(readFileSync("output/material-alpha/project.zip")),
    scene = JSON.parse(new TextDecoder().decode(archive["project.json"]));
  const materials = Object.values(scene.assets).flatMap((a) => {
    const b = archive[a.path],
      v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return JSON.parse(
      new TextDecoder().decode(b.subarray(20, 20 + v.getUint32(12, true))),
    ).materials;
  });
  assert.ok(
    materials.some(
      (m) =>
        m.alphaMode === "BLEND" &&
        m.pbrMetallicRoughness.baseColorFactor[3] === 0.25 &&
        m.doubleSided === false,
    ),
  );
  assert.ok(
    materials.some(
      (m) =>
        m.alphaMode === "MASK" &&
        m.alphaCutoff === 0.65 &&
        m.pbrMetallicRoughness.baseColorFactor[3] === 0.8 &&
        m.doubleSided === false,
    ),
  );
  await page
    .locator('input[accept=".zip"]')
    .setInputFiles(resolve("output/material-alpha/project.zip"));
  await ready();
  await select("Mesh · 2 · BLEND");
  assert.equal(
    await page.getByLabel("不透明度", { exact: true }).inputValue(),
    "0.25",
  );
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS alpha model import, rendered edits, sidedness, undo/redo and project ZIP save/reopen",
  );
} finally {
  await browser.close();
}
