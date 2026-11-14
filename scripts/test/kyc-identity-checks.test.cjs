'use strict';
/**
 * In-house face detection, liveness and document-to-selfie match tests.
 *
 * These pin the behaviour a reviewer depends on: a portrait is found where one
 * exists and not where one does not, a sharp live capture passes liveness while
 * a blurred "printed" capture fails, and two portraits of the same synthetic
 * subject match while two different subjects do not. The detector is a signal,
 * so the tests assert the signal, not a legal outcome.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { decodeImage } = require('../../.test-build/decode.js');
const { detectFaces, faceDescriptor, compareFaces } = require('../../.test-build/face.js');
const { assessLiveness, sharpness } = require('../../.test-build/liveness.js');
const { matchDocumentToSelfie, FACE_MATCH_THRESHOLD } = require('../../.test-build/match.js');
const { runIdentityChecks } = require('../../.test-build/identity-checks.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'kyc');
const load = (name) => decodeImage(new Uint8Array(fs.readFileSync(path.join(FIXTURES, name))));
const b64 = (name) => fs.readFileSync(path.join(FIXTURES, name)).toString('base64');

test('a face is detected in a synthetic portrait', () => {
  const faces = detectFaces(load('selfie_face.png'));
  assert.equal(faces.length, 1);
  assert.ok(faces[0].width > 20 && faces[0].height > 20);
  assert.ok(faces[0].fill > 0.5);
});

test('no face is detected in a flat background', () => {
  assert.equal(detectFaces(load('no_face.png')).length, 0);
});

test('a face descriptor is normalised (zero mean, unit variance)', () => {
  const image = load('selfie_face.png');
  const descriptor = faceDescriptor(image, detectFaces(image)[0]);
  const mean = descriptor.reduce((a, b) => a + b, 0) / descriptor.length;
  const variance = descriptor.reduce((a, b) => a + (b - mean) ** 2, 0) / descriptor.length;
  assert.ok(Math.abs(mean) < 1e-6);
  assert.ok(Math.abs(variance - 1) < 1e-3);
});

test('identical faces compare at 1 and unrelated descriptors below the threshold', () => {
  const image = load('selfie_face.png');
  const descriptor = faceDescriptor(image, detectFaces(image)[0]);
  assert.ok(compareFaces(descriptor, descriptor) > 0.999);
  const other = faceDescriptor(load('selfie_other.png'), detectFaces(load('selfie_other.png'))[0]);
  assert.ok(compareFaces(descriptor, other) < FACE_MATCH_THRESHOLD);
});

test('compareFaces refuses mismatched descriptor lengths', () => {
  assert.throws(() => compareFaces(new Float32Array(4), new Float32Array(5)));
});

test('a sharp live selfie passes liveness', () => {
  const selfie = load('selfie_face.png');
  const moved = load('selfie_face_moved.png');
  const result = assessLiveness([selfie, moved], detectFaces(selfie)[0]);
  assert.equal(result.live, true);
  assert.ok(result.signals.some((s) => s.name === 'frame_motion'));
});

test('a blurred capture fails the sharpness check', () => {
  const blurred = load('selfie_blurred.png');
  const result = assessLiveness([blurred], detectFaces(blurred)[0]);
  assert.equal(result.live, false);
  assert.equal(result.signals.find((s) => s.name === 'sharpness').passed, false);
});

test('two identical frames are not treated as movement', () => {
  const selfie = load('selfie_face.png');
  const result = assessLiveness([selfie, selfie], detectFaces(selfie)[0]);
  assert.equal(result.signals.find((s) => s.name === 'frame_motion').passed, false);
  assert.equal(result.live, false);
});

test('liveness fails closed when no face is present', () => {
  const result = assessLiveness([load('no_face.png')], null);
  assert.equal(result.live, false);
  assert.equal(result.signals[0].name, 'face_present');
});

test('sharpness of a blurred image is below that of the sharp original', () => {
  const sharp = load('selfie_face.png');
  const blurred = load('selfie_blurred.png');
  assert.ok(sharpness(blurred, detectFaces(blurred)[0]) < sharpness(sharp, detectFaces(sharp)[0]));
});

test('the same subject matches and a different subject does not', () => {
  const same = matchDocumentToSelfie(load('doc_face.png'), load('selfie_face.png'));
  assert.equal(same.documentFaceFound, true);
  assert.equal(same.selfieFaceFound, true);
  assert.equal(same.matched, true);
  assert.ok(same.similarity >= FACE_MATCH_THRESHOLD);

  const different = matchDocumentToSelfie(load('doc_face.png'), load('selfie_other.png'));
  assert.equal(different.matched, false);
});

test('a document without a portrait is reported, not silently passed', () => {
  const result = matchDocumentToSelfie(load('no_face.png'), load('selfie_face.png'));
  assert.equal(result.documentFaceFound, false);
  assert.equal(result.similarity, null);
  assert.equal(result.matched, false);
});

test('runIdentityChecks records a match for a matching pair', () => {
  const result = runIdentityChecks({
    documentFront: b64('doc_face.png'),
    selfie: b64('selfie_face.png'),
    extraFrames: [b64('selfie_face_moved.png')],
  });
  assert.equal(result.analysed, true);
  assert.equal(result.documentFaceFound, true);
  assert.equal(result.selfieFaceFound, true);
  assert.equal(result.faceMatched, true);
  assert.equal(result.liveness.live, true);
});

test('runIdentityChecks reports a non-match and never throws on a missing portrait', () => {
  const result = runIdentityChecks({ documentFront: b64('no_face.png'), selfie: b64('selfie_face.png') });
  assert.equal(result.analysed, true);
  assert.equal(result.faceMatched, false);
  assert.ok(result.notes.some((note) => note.includes('No portrait')));
});

test('runIdentityChecks fails closed when no image can be decoded', () => {
  const result = runIdentityChecks({ documentFront: b64('solid_rgb.png'), selfie: b64('solid_rgb.png') });
  assert.equal(result.analysed, true);
  assert.equal(result.faceMatched, false);
  assert.equal(result.liveness.live, false);
});
