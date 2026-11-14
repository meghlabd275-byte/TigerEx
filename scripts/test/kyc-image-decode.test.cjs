'use strict';
/**
 * In-house image decoder tests.
 *
 * The decoder is the gate for every pixel the identity checks read, so it is
 * pinned against real encoder output: PNG (RGB, RGBA, grayscale, indexed,
 * interlaced) and JPEG (baseline, progressive, grayscale, chroma-subsampled).
 * A decoder that silently produced a blank image would let a check "pass" on
 * nothing, so the tests assert exact pixel values and refuse malformed input.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { decodeImage, detectDecodableFormat, downscale, ImageDecodeError } = require('../../.test-build/decode.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'kyc');
const load = (name) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));

function pixel(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

test('PNG truecolour decodes to the exact colour', () => {
  const image = decodeImage(load('solid_rgb.png'));
  assert.equal(image.width, 16);
  assert.equal(image.height, 16);
  assert.deepEqual(pixel(image, 8, 8), [200, 50, 25, 255]);
});

test('PNG with an alpha channel keeps the alpha', () => {
  const image = decodeImage(load('solid_rgba.png'));
  assert.deepEqual(pixel(image, 8, 8), [10, 240, 30, 128]);
});

test('PNG grayscale decodes to neutral grey', () => {
  const image = decodeImage(load('solid_gray.png'));
  assert.deepEqual(pixel(image, 8, 8), [128, 128, 128, 255]);
});

test('PNG indexed (palette) decodes through the palette', () => {
  const image = decodeImage(load('solid_palette.png'));
  assert.deepEqual(pixel(image, 8, 8), [5, 5, 5, 255]);
});

test('interlaced PNG decodes every pixel', () => {
  const image = decodeImage(load('interlaced.png'));
  assert.deepEqual(pixel(image, 3, 12), [77, 88, 99, 255]);
});

test('baseline JPEG decodes to the source colour within quantisation error', () => {
  const image = decodeImage(load('solid_baseline.jpg'));
  const [r, g, b] = pixel(image, 8, 8);
  assert.ok(Math.abs(r - 200) <= 6 && Math.abs(g - 50) <= 6 && Math.abs(b - 25) <= 6, `got ${r},${g},${b}`);
});

test('progressive JPEG decodes to the source colour', () => {
  const image = decodeImage(load('solid_prog.jpg'));
  const [r, g, b] = pixel(image, 8, 8);
  assert.ok(Math.abs(r - 200) <= 6 && Math.abs(g - 50) <= 6 && Math.abs(b - 25) <= 6, `got ${r},${g},${b}`);
});

test('grayscale JPEG decodes to neutral grey', () => {
  const image = decodeImage(load('solid_gray.jpg'));
  const [r, g, b] = pixel(image, 8, 8);
  assert.ok(Math.abs(r - 128) <= 4 && r === g && g === b, `got ${r},${g},${b}`);
});

test('a chroma-subsampled JPEG reconstructs the edge structure', () => {
  // A left-black / right-white split must survive the 4:2:0 upsample as a step,
  // not a flat average, or a document photo would lose the details a reviewer
  // relies on.
  const image = decodeImage(load('split_bw.jpg'));
  const left = pixel(image, 2, 8)[0];
  const right = pixel(image, 13, 8)[0];
  assert.ok(left < 40, `left half should be dark, got ${left}`);
  assert.ok(right > 215, `right half should be light, got ${right}`);
});

test('progressive JPEG reconstructs the same edge structure', () => {
  const image = decodeImage(load('split_bw_prog.jpg'));
  assert.ok(pixel(image, 2, 8)[0] < 40);
  assert.ok(pixel(image, 13, 8)[0] > 215);
});

test('a JPEG gradient is close to the PNG original', () => {
  const jpeg = decodeImage(load('grad_baseline.jpg'));
  const png = decodeImage(load('grad.png'));
  assert.equal(jpeg.width, png.width);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < jpeg.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      sum += Math.abs(jpeg.data[i + c] - png.data[i + c]);
      count += 1;
    }
  }
  const meanAbsError = sum / count;
  assert.ok(meanAbsError < 6, `mean absolute error ${meanAbsError} is too high`);
});

test('a progressive JPEG gradient is close to the PNG original', () => {
  const jpeg = decodeImage(load('grad_progressive.jpg'));
  const png = decodeImage(load('grad.png'));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < jpeg.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      sum += Math.abs(jpeg.data[i + c] - png.data[i + c]);
      count += 1;
    }
  }
  assert.ok(sum / count < 6, 'progressive decode should track the original');
});

test('detectDecodableFormat reads the container, not the caller', () => {
  assert.equal(detectDecodableFormat(load('solid_rgb.png')), 'png');
  assert.equal(detectDecodableFormat(load('solid_baseline.jpg')), 'jpeg');
  assert.equal(detectDecodableFormat(new Uint8Array([0x47, 0x49, 0x46])), null);
});

test('a non-image is refused, not decoded to blank', () => {
  assert.throws(() => decodeImage(new Uint8Array([1, 2, 3, 4])), ImageDecodeError);
});

test('a PNG with a corrupted signature is refused', () => {
  const bytes = load('solid_rgb.png');
  bytes[1] = 0x00;
  assert.throws(() => decodeImage(bytes), ImageDecodeError);
});

test('downscale bounds the longest edge and preserves colour', () => {
  const image = decodeImage(load('solid_rgb.png'));
  const small = downscale(image, 4);
  assert.equal(small.width, 4);
  assert.equal(small.height, 4);
  assert.deepEqual(pixel(small, 2, 2), [200, 50, 25, 255]);
});
