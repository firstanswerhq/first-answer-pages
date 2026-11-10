import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  MAX_IMAGE_BYTES,
  MAX_FORM_BYTES,
  ACCEPTED_IMAGE_TYPES,
  detectImageType,
  decodeBase64Image,
} from '../server/lib/upload.js';

// Independent oracle: compares hex strings instead of byte-by-byte checks.
function oracleType(bytes) {
  const hex = Buffer.from(bytes).toString('hex');
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') {
    return 'image/webp';
  }
  return null;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('');
const b64Char = fc.constantFrom(...B64_CHARS);
const anyBytes = fc.uint8Array({ minLength: 0, maxLength: 64 });
const nonEmptyBytes = fc.uint8Array({ minLength: 1, maxLength: 256 });
const tail = fc.uint8Array({ minLength: 0, maxLength: 64 });

const signedBytes = fc.oneof(
  tail.map((t) => ({ type: 'image/jpeg', bytes: Uint8Array.from([0xff, 0xd8, 0xff, ...t]) })),
  tail.map((t) => ({
    type: 'image/png',
    bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...t]),
  })),
  fc.tuple(fc.uint8Array({ minLength: 4, maxLength: 4 }), tail).map(([size, t]) => ({
    type: 'image/webp',
    bytes: Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, ...size, 0x57, 0x45, 0x42, 0x50, ...t,
    ]),
  })),
);

const wsInsertions = fc.array(
  fc.record({
    pos: fc.nat(1000),
    ws: fc.constantFrom(' ', '\n', '\r\n', '\t'),
  }),
  { maxLength: 8 },
);

function insertWhitespace(s, insertions) {
  let out = s;
  const sorted = [...insertions].sort((a, b) => b.pos - a.pos);
  for (const { pos, ws } of sorted) {
    const at = pos % (out.length + 1);
    out = out.slice(0, at) + ws + out.slice(at);
  }
  return out;
}

// Property 12: Image signature detection and base64 decoding
// **Validates: Requirements 1.5, 1.9, 1.10**
test('Property 12: signature prefix plus random tail is detected as that type', () => {
  fc.assert(
    fc.property(signedBytes, ({ type, bytes }) => {
      assert.equal(detectImageType(bytes), type);
      assert.equal(detectImageType(Buffer.from(bytes)), type);
    }),
  );
});

test('Property 12: detectImageType agrees with the independent oracle on random bytes', () => {
  fc.assert(
    fc.property(anyBytes, (bytes) => {
      assert.equal(detectImageType(bytes), oracleType(bytes));
    }),
  );
});

test('Property 12: bytes without a signature give null', () => {
  const unsigned = anyBytes.filter((b) => oracleType(b) === null);
  fc.assert(
    fc.property(unsigned, (bytes) => {
      assert.equal(detectImageType(bytes), null);
    }),
  );
});

test('Property 12: base64 of random bytes round-trips', () => {
  fc.assert(
    fc.property(nonEmptyBytes, (bytes) => {
      const out = decodeBase64Image(Buffer.from(bytes).toString('base64'));
      assert.ok(out);
      assert.deepEqual(new Uint8Array(out), bytes);
    }),
  );
});

test('Property 12: round-trips with inserted whitespace and a data: prefix', () => {
  fc.assert(
    fc.property(
      nonEmptyBytes,
      wsInsertions,
      fc.constantFrom('', 'data:image/png;base64,', 'data:image/jpeg;base64,'),
      fc.constantFrom('', ' ', '\n'),
      (bytes, insertions, prefix, pad) => {
        const b64 = insertWhitespace(Buffer.from(bytes).toString('base64'), insertions);
        const out = decodeBase64Image(pad + prefix + b64 + pad);
        assert.ok(out);
        assert.deepEqual(new Uint8Array(out), bytes);
      },
    ),
  );
});

test('Property 12: characters outside the base64 alphabet give null', () => {
  const badChar = fc.constantFrom('!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '-', '_', '.', ':', ';', '"', 'é', '\u0000');
  fc.assert(
    fc.property(nonEmptyBytes, badChar, fc.nat(1000), (bytes, bad, pos) => {
      const s = Buffer.from(bytes).toString('base64');
      const at = pos % (s.length + 1);
      const broken = s.slice(0, at) + bad + s.slice(at);
      assert.equal(decodeBase64Image(broken), null);
    }),
  );
});

test('Property 12: length not a multiple of four gives null', () => {
  fc.assert(
    fc.property(nonEmptyBytes, fc.integer({ min: 1, max: 3 }), (bytes, cut) => {
      const s = Buffer.from(bytes).toString('base64');
      assert.equal(decodeBase64Image(s.slice(0, s.length - cut)), null);
    }),
  );
});

test('Property 12: misplaced padding gives null', () => {
  const misplaced = fc
    .tuple(
      fc.array(b64Char, { minLength: 1, maxLength: 20 }),
      fc.array(b64Char, { minLength: 1, maxLength: 20 }),
    )
    .map(([a, b]) => a.join('') + '=' + b.join(''))
    .filter((s) => s.length % 4 === 0);
  fc.assert(
    fc.property(misplaced, (s) => {
      assert.equal(decodeBase64Image(s), null);
    }),
  );
});

test('size constants and accepted types', () => {
  assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
  assert.equal(MAX_FORM_BYTES, 8 * 1024 * 1024);
  assert.ok(MAX_FORM_BYTES > MAX_IMAGE_BYTES);
  assert.deepEqual(ACCEPTED_IMAGE_TYPES, ['image/jpeg', 'image/png', 'image/webp']);
});

test('detectImageType: known signatures and edge cases', () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(
    detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png',
  );
  assert.equal(
    detectImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])),
    'image/webp',
  );
  // RIFF without WEBP (e.g. WAV) is not an image
  assert.equal(
    detectImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])),
    null,
  );
  // Truncated signatures
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8])), null);
  assert.equal(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(detectImageType(Buffer.from('RIFF')), null);
  // Empty and non-buffers
  assert.equal(detectImageType(Buffer.alloc(0)), null);
  assert.equal(detectImageType(null), null);
  assert.equal(detectImageType(undefined), null);
  assert.equal(detectImageType({}), null);
});

test('decodeBase64Image: empty, whitespace-only, and non-string input give null', () => {
  assert.equal(decodeBase64Image(''), null);
  assert.equal(decodeBase64Image('  \n\t '), null);
  assert.equal(decodeBase64Image('data:image/png;base64,'), null);
  for (const v of [null, undefined, 42, {}, [], true, Buffer.from('AAAA')]) {
    assert.equal(decodeBase64Image(v), null);
  }
});

test('decodeBase64Image: data-URL prefix, whitespace, and bad input examples', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const b64 = png.toString('base64');
  const withPrefix = decodeBase64Image(`data:image/png;base64,${b64}`);
  assert.deepEqual(new Uint8Array(withPrefix), new Uint8Array(png));
  assert.equal(detectImageType(withPrefix), 'image/png');
  const spaced = decodeBase64Image(b64.slice(0, 4) + '\r\n ' + b64.slice(4));
  assert.deepEqual(new Uint8Array(spaced), new Uint8Array(png));
  assert.equal(decodeBase64Image('AAA'), null);
  assert.equal(decodeBase64Image('AA!A'), null);
  assert.equal(decodeBase64Image('A==='), null);
  assert.equal(decodeBase64Image('AA=A'), null);
  assert.equal(decodeBase64Image('=AAA'), null);
  assert.equal(decodeBase64Image('AAAA===='), null);
});
