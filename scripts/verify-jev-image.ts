import assert from "node:assert/strict";
import sharp from "sharp";
import { prepareJevImage } from "../lib/search/image";

async function main() {
  for (const [width, height] of [[10, 20], [3000, 100], [2800, 2200]]) {
    const source = await sharp({ create: { width, height, channels: 3, background: "red" } }).png().toBuffer();
    const output = await prepareJevImage(source);
    assert.ok(output);
    const meta = await sharp(output).metadata();
    assert.equal(meta.format, "jpeg");
    assert.ok(meta.width! >= 280 && meta.width! <= 1568);
    assert.ok(meta.height! >= 280 && meta.height! <= 1568);
    assert.ok(output.length <= 2 * 1024 * 1024);
  }
  for (const format of ["webp", "gif"] as const) {
    const source = await sharp({ create: { width: 300, height: 300, channels: 3, background: "red" } })[format]().toBuffer();
    const output = await prepareJevImage(source);
    assert.ok(output, `${format} conversion failed`);
    assert.equal((await sharp(output).metadata()).format, "jpeg");
  }
  assert.equal(await prepareJevImage(new Uint8Array([1, 2, 3])), null);
  console.log("Jev image preparation: tiny, wide, large, WebP, GIF and malformed inputs passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
