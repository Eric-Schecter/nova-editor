import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import assert from "node:assert/strict";
import { decode } from "./testing/png.mjs";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu"],
});
mkdirSync("output/lights-browser", { recursive: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1500, height: 1000 },
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
    .setInputFiles(resolve("tests/fixtures/material-dual.glb"));
  await page
    .getByText("2 个模型实例", { exact: true })
    .waitFor({ timeout: 120000 });
  const ready = async () => {
    await page.waitForTimeout(350);
    assert(
      !((await page.locator("footer").textContent()) || "").includes("失败"),
    );
  };
  const shot = async (name) => {
    await ready();
    const png = await page.locator("canvas").screenshot();
    writeFileSync("output/lights-browser/" + name + ".png", png);
    return decode(png);
  };
  const difference = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.pixels.length; i++)
      n += Math.abs(a.pixels[i] - b.pixels[i]);
    return n / a.pixels.length;
  };
  for (const kind of ["方向光", "点光", "聚光"]) {
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page.getByRole("menuitem", { name: kind, exact: true }).click();
    await page.getByLabel("灯光类型", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("灯光类型", { exact: true }).inputValue(),
      kind === "方向光" ? "directional" : kind === "点光" ? "point" : "spot",
    );
    if (kind !== "方向光")
      assert(
        await page.getByLabel("节点阴影开关", { exact: true }).isDisabled(),
      );
    await page.getByLabel("节点灯光强度", { exact: true }).fill("12");
    if (kind === "聚光") {
      await page.getByLabel("内锥半角", { exact: true }).fill("20");
      await page.getByLabel("外锥半角", { exact: true }).fill("45");
    }
    await page
      .getByRole("button", { name: "应用节点设置", exact: true })
      .click();
    await ready();
  }
  const all = await shot("all");
  await page.getByRole("button", { name: "关闭灯光", exact: true }).click();
  const off = await shot("spot-off");
  assert(difference(all, off) > 0.01, "Spot toggling did not change pixels");
  await page.getByRole("button", { name: "启用灯光", exact: true }).click();
  await ready();
  await page.getByLabel("节点灯光强度", { exact: true }).fill("0");
  await page.getByRole("button", { name: "应用节点设置", exact: true }).click();
  await ready();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await ready();
  assert.equal(
    await page.getByLabel("节点灯光强度", { exact: true }).inputValue(),
    "12",
  );
  const download = page.waitForEvent("download");
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+s" : "Control+s",
  );
  await (await download).saveAs(resolve("output/lights-browser/project.zip"));
  const archive = unzipSync(readFileSync("output/lights-browser/project.zip")),
    scene = JSON.parse(new TextDecoder().decode(archive["project.json"])),
    lights = scene.nodes.filter((n) => n.light);
  assert.equal(scene.schemaVersion, 6);
  assert.equal(lights.length, 3);
  assert(lights.every((n) => n.light.active));
  assert(
    lights.some(
      (n) =>
        n.light.type === "spot" &&
        Math.abs(n.light.outerConeAngle - Math.PI / 4) < 1e-6,
    ),
  );
  await page
    .locator('input[accept=".zip"]')
    .setInputFiles(resolve("output/lights-browser/project.zip"));
  await ready();
  await page.getByRole("treeitem").filter({ hasText: "Spot light" }).click();
  assert.equal(
    await page.getByLabel("灯光类型", { exact: true }).inputValue(),
    "spot",
  );
  assert.equal(
    await page.getByLabel("外锥半角", { exact: true }).inputValue(),
    "45",
  );
  await page.screenshot({ path: "output/lights-browser/editor.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS editor WebGPU light creation, capabilities, live pixels, independent enable, undo, ZIP save/reopen",
  );
} finally {
  await browser.close();
}
