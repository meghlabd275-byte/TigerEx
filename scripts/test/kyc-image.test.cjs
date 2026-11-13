'use strict';
/**
 * Identity-document image validation tests.
 *
 * The format is read from the bytes, not the client's declaration, so a
 * mismatched or non-image payload is refused.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { detectImageFormat, contentMatchesType } = require('../../.test-build/image.js');

const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const webp = () => Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const pdf = () => Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

test('each container is detected from its magic bytes', () => {
  assert.equal(detectImageFormat(png()), 'png');
  assert.equal(detectImageFormat(jpeg()), 'jpeg');
  assert.equal(detectImageFormat(webp()), 'webp');
  assert.equal(detectImageFormat(pdf()), 'pdf');
});

test('a non-image payload is not detected', () => {
  const html = new TextEncoder().encode('<script>alert(1)</script>');
  assert.equal(detectImageFormat(html), null);
  assert.equal(contentMatchesType(html, 'image/png'), false);
});

test('a payload whose bytes disagree with the declared type is refused', () => {
  assert.equal(contentMatchesType(png(), 'image/png'), true);
  assert.equal(contentMatchesType(png(), 'image/jpeg'), false, 'PNG bytes declared as JPEG');
  assert.equal(contentMatchesType(jpeg(), 'image/png'), false, 'JPEG bytes declared as PNG');
  assert.equal(contentMatchesType(pdf(), 'image/png'), false, 'PDF bytes declared as PNG');
});

test('jpeg aliases are accepted', () => {
  assert.equal(contentMatchesType(jpeg(), 'image/jpg'), true);
  assert.equal(contentMatchesType(jpeg(), 'image/jpeg'), true);
});
