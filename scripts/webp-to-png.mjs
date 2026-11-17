/**
 * Converts the three original Veredicta screenshots (webp) to PNG so
 * imgdiff.py — which only decodes PNG — can read them.
 *
 * Standard library + the already-installed @playwright/test chromium: the
 * image is decoded by Chromium and re-encoded at its natural size via an
 * element screenshot (no resampling, no new downloads from Veredicta).
 *
 * Usage: node scripts/webp-to-png.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screensDir = path.join(root, "replica", "screens");
const files = [
  "asistente-panel-v1.webp",
  "asistente-expediente-v1.webp",
  "finanzas.webp",
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  for (const name of files) {
    const src = path.join(screensDir, name);
    const b64 = readFileSync(src).toString("base64");
    await page.setContent(
      `<!doctype html><html><body style="margin:0">` +
        `<img id="i" src="data:image/webp;base64,${b64}"></body></html>`,
    );
    await page.waitForFunction(() => {
      const img = document.getElementById("i");
      return Boolean(img && img.complete && img.naturalWidth > 0);
    });
    const img = page.locator("#i");
    const out = src.replace(/\.webp$/, ".png");
    const box = await img.boundingBox();
    await img.screenshot({ path: out });
    console.log(
      `${name} -> ${path.relative(root, out)} (${Math.round(box.width)}x${Math.round(box.height)})`,
    );
  }
} finally {
  await browser.close();
}
