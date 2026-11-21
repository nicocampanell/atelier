import assert from "node:assert/strict";
import { JEV_MAX_BYTES, jevFormat, prepareJevImage } from "../lib/search/image";

async function main() {
  // Minimal JPEG (SOI + EOI) and PNG signatures.
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  assert.equal(jevFormat(jpeg), "jpg");
  assert.equal(jevFormat(png), "png");
  assert.equal(jevFormat(Uint8Array.of(1, 2, 3)), null);

  assert.deepEqual(prepareJevImage(jpeg), jpeg);
  assert.deepEqual(prepareJevImage(png), png);
  assert.equal(prepareJevImage(new Uint8Array([1, 2, 3])), null);
  assert.equal(prepareJevImage(new Uint8Array(JEV_MAX_BYTES + 1).fill(0xff)), null);

  console.log("Jev image prep: pass-through within limits; skip oversize/unsupported");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
