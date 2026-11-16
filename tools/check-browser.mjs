import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { decode } from "./testing/png.mjs";
const { chromium } = await import(
  process.env.NOVA_PLAYWRIGHT_MODULE || "playwright"
);
const base = process.env.NOVA_EDITOR_URL || "http://127.0.0.1:5223";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu"],
});
mkdirSync("output/formal-sdk-browser", { recursive: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("favicon"))
      errors.push(r.status() + " " + r.url());
  });
  await page.addInitScript(() =>
    Object.defineProperty(window, "showSaveFilePicker", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto(base);
  await page
    .locator('input[accept=".glb"]')
    .setInputFiles(resolve("tests/fixtures/material-dual.glb"));
  await page
    .getByText("2 个模型实例", { exact: true })
    .waitFor({ timeout: 120000 });
  const ready = async () => {
    await page.waitForTimeout(100);
    await page.waitForFunction(
      () => {
        const text = document.querySelector("footer")?.textContent || "";
        if (text.includes("场景渲染失败")) throw Error(text);
        return !document
          .querySelector(".viewport-footer")
          ?.textContent?.includes("正在加载");
      },
      undefined,
      { timeout: 60000 },
    );
    await page.waitForTimeout(100);
  };
  await ready();
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Mesh · 1 · Left" })
    .click();
  await page.getByRole("tab", { name: "材质", exact: true }).click();
  await page.getByLabel("材质基础色十六进制").fill("#00ff00");
  await page.getByLabel("粗糙度", { exact: true }).fill(".25");
  await page.getByLabel("金属度", { exact: true }).fill(".65");
  await page.getByRole("button", { name: "应用材质", exact: true }).click();
  await ready();
  const capture = async (name) => {
    const png = await page.locator("canvas").screenshot();
    writeFileSync(`output/formal-sdk-browser/${name}.png`, png);
    return decode(png);
  };
  const colors = (im) => {
    let green = 0,
      blue = 0;
    for (let i = 0; i < im.pixels.length; i += im.channels) {
      if (
        im.pixels[i + 1] > 80 &&
        im.pixels[i + 1] > im.pixels[i] * 1.5 &&
        im.pixels[i + 1] > im.pixels[i + 2] * 1.5
      )
        green++;
      if (
        im.pixels[i + 2] > 80 &&
        im.pixels[i + 2] > im.pixels[i] * 1.5 &&
        im.pixels[i + 2] > im.pixels[i + 1] * 1.5
      )
        blue++;
    }
    return { green, blue };
  };
  console.log("Checking runtime material pixels");
  const edited = colors(await capture("runtime-material"));
  assert.ok(edited.green > 100 && edited.blue > 100, JSON.stringify(edited));
  await page
    .getByLabel("基础色贴图", { exact: true })
    .setInputFiles(resolve("tests/fixtures/checker.png"));
  await page.getByRole("button", { name: "应用材质", exact: true }).click();
  await page.getByText("已内嵌", { exact: true }).first().waitFor();
  await ready();
  await capture("runtime-texture");
  await page.getByRole("button", { name: "切换投影模式" }).click();
  await ready();
  await page.getByRole("button", { name: "顶视图 (+Y)" }).click();
  await ready();
  await page.getByRole("button", { name: "视图", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "恢复默认视角", exact: true })
    .click();
  await ready();
  await page.getByRole("tab", { name: "光照", exact: true }).click();
  await page.getByLabel("投射阴影", { exact: true }).uncheck();
  await ready();
  await page.getByLabel("投射阴影", { exact: true }).check();
  await ready();
  console.log("Checking environment and fog");
  await page.getByRole("tab", { name: "环境", exact: true }).click();
  await page.getByRole("button", { name: "摄影棚贴图", exact: true }).click();
  await ready();
  await page.getByRole("button", { name: "移除环境贴图", exact: true }).click();
  await page.getByRole("button", { name: "应用场景环境", exact: true }).click();
  await ready();
  await page.getByLabel("雾效类型", { exact: true }).selectOption("linear");
  await page.getByLabel("雾起点", { exact: true }).fill("0");
  await page.getByLabel("雾终点", { exact: true }).fill("1");
  await page.getByLabel("雾颜色", { exact: true }).fill("#00ff00");
  await page.getByRole("button", { name: "应用场景环境", exact: true }).click();
  await ready();
  const fog = colors(await capture("linear-fog"));
  assert.ok(fog.green > edited.green + 500, JSON.stringify({ edited, fog }));
  await page.getByLabel("雾终点", { exact: true }).fill("16");
  await page.getByRole("button", { name: "应用场景环境", exact: true }).click();
  await ready();
  await capture("partial-fog");
  await page.getByLabel("雾效类型", { exact: true }).selectOption("exp2");
  await page.getByLabel("雾密度", { exact: true }).fill("1");
  await page.getByRole("button", { name: "应用场景环境", exact: true }).click();
  await ready();
  await capture("exp2-fog");
  await page.getByLabel("雾效类型", { exact: true }).selectOption("none");
  await page.getByRole("button", { name: "应用场景环境", exact: true }).click();
  await ready();
  const download = page.waitForEvent("download");
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+s" : "Control+s",
  );
  const file = await download;
  await file.saveAs(resolve("output/formal-sdk-browser/project.zip"));
  const archive = unzipSync(
      readFileSync("output/formal-sdk-browser/project.zip"),
    ),
    scene = JSON.parse(new TextDecoder().decode(archive["project.json"]));
  assert.equal(scene.world.environment.map, null);
  assert.equal(scene.world.fog.mode, "none");
  const editedGLBs = Object.values(scene.assets)
    .map((a) => archive[a.path])
    .filter(Boolean)
    .map((bytes) =>
      JSON.parse(
        new TextDecoder().decode(
          bytes.slice(
            20,
            20 +
              new DataView(
                bytes.buffer,
                bytes.byteOffset,
                bytes.byteLength,
              ).getUint32(12, true),
          ),
        ),
      ),
    );
  assert.ok(
    editedGLBs.some((doc) =>
      doc.materials.some(
        (m) =>
          m.pbrMetallicRoughness?.roughnessFactor === 0.25 &&
          m.pbrMetallicRoughness?.metallicFactor === 0.65,
      ),
    ),
  );
  await page
    .locator('input[accept=".zip"]')
    .setInputFiles(resolve("output/formal-sdk-browser/project.zip"));
  await ready();
  await page.screenshot({
    path: "output/formal-sdk-browser/editor-restored.png",
  });
  if (process.env.NOVA_EDITOR_REAL_DEMO) {
    await page
      .locator('input[accept=".zip"]')
      .setInputFiles(resolve(process.env.NOVA_EDITOR_REAL_DEMO));
    await page
      .getByText("3 个模型实例", { exact: true })
      .waitFor({ timeout: 120000 });
    await ready();
    await page.screenshot({
      path: "output/formal-sdk-browser/editor-real-demo.png",
    });
    console.log("PASS existing Helmet / Avocado multi-instance project");
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS editor UI: runtime material/texture, orthographic/poles, shadows, environment clear, linear/exp2 fog, project ZIP restore",
  );
} finally {
  await browser.close();
}
