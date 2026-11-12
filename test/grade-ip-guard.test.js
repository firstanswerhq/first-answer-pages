import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { isPublicAddress } from '../server/lib/ip-guard.js';

// ---- Independent oracle: BigInt bit masks built from the range table ------

const V4_TABLE = [
  [0x00000000n, 8], [0x0a000000n, 8], [0x64400000n, 10], [0x7f000000n, 8],
  [0xa9fe0000n, 16], [0xac100000n, 12], [0xc0000000n, 24], [0xc0000200n, 24],
  [0xc0586300n, 24], [0xc0a80000n, 16], [0xc6120000n, 15], [0xc6336400n, 24],
  [0xcb007100n, 24], [0xe0000000n, 4], [0xf0000000n, 4],
];

const inPrefix = (value, base, bits, width) => {
  const shift = BigInt(width - bits);
  return (value >> shift) === (base >> shift);
};

const oracleV4 = n => !V4_TABLE.some(([base, bits]) => inPrefix(n, base, bits, 32));

const big = groups => groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);

function oracleV6(groups) {
  const v = big(groups);
  const low = v & 0xffffffffn;
  if (inPrefix(v, 0xffffn << 32n, 96, 128)) return oracleV4(low); // ::ffff:0:0/96
  if (inPrefix(v, 0n, 96, 128)) return oracleV4(low); // ::/96
  if (inPrefix(v, 0x0064ff9bn << 96n, 96, 128)) return oracleV4(low); // 64:ff9b::/96
  const top = base => BigInt(base) << 112n;
  if (!inPrefix(v, top(0x2000), 3, 128)) return false;
  if (inPrefix(v, top(0x2001), 23, 128)) return false;
  if (inPrefix(v, (0x20010db8n << 96n), 32, 128)) return false;
  if (inPrefix(v, top(0x2002), 16, 128)) return false;
  if (inPrefix(v, top(0x3fff), 20, 128)) return false;
  return true;
}

// ---- Formatting helpers ---------------------------------------------------

const dotted = n => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');
const hex = g => g.toString(16);

function compress(groups) {
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i += 1; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j += 1;
    if (j - i > bestLen) { bestStart = i; bestLen = j - i; }
    i = j;
  }
  if (bestLen < 2) return groups.map(hex).join(':');
  const left = groups.slice(0, bestStart).map(hex).join(':');
  const right = groups.slice(bestStart + bestLen).map(hex).join(':');
  return `${left}::${right}`;
}

// ---- Generators -----------------------------------------------------------

const u32 = fc.integer({ min: 0, max: 0xffffffff });
const group = fc.integer({ min: 0, max: 0xffff });

// Mix random addresses with addresses inside each refused range.
const v4Number = fc.oneof(
  u32,
  fc.tuple(fc.constantFrom(...V4_TABLE), u32).map(([[base, bits], r]) => {
    const size = 2 ** (32 - bits);
    return Number(base) + (r % size);
  }),
);

const v6Groups = fc.oneof(
  fc.array(group, { minLength: 8, maxLength: 8 }),
  // sparse groups so "::" shows up
  fc.array(fc.oneof(fc.constant(0), group), { minLength: 8, maxLength: 8 }),
  // inside 2000::/3 and the carved-out blocks
  fc.tuple(fc.constantFrom(0x2001, 0x2002, 0x3fff, 0x2a00, 0x2606, 0x3000, 0x4000, 0xfe80, 0xfc00, 0xfec0, 0xff02),
    group, fc.array(group, { minLength: 6, maxLength: 6 })).map(([a, b, rest]) => [a, b, ...rest]),
  // embedded IPv4 forms
  fc.tuple(fc.constantFrom('mapped', 'compat', 'nat64'), v4Number).map(([kind, n]) => {
    const hi = Math.floor(n / 65536);
    const lo = n % 65536;
    if (kind === 'mapped') return [0, 0, 0, 0, 0, 0xffff, hi, lo];
    if (kind === 'compat') return [0, 0, 0, 0, 0, 0, hi, lo];
    return [0x64, 0xff9b, 0, 0, 0, 0, hi, lo];
  }),
);

// Feature: ai-visibility-grader, Property 1: Public-address test matches the range table
test('Property 1: IPv4 public-address test matches the range table', () => {
  fc.assert(fc.property(v4Number, n => {
    assert.equal(isPublicAddress(dotted(n)), oracleV4(BigInt(n)), dotted(n));
  }), { numRuns: 500 });
});

test('Property 1: IPv6 public-address test matches the range table (all spellings)', () => {
  fc.assert(fc.property(v6Groups, groups => {
    const expected = oracleV6(groups);
    assert.equal(isPublicAddress(groups.map(hex).join(':')), expected, 'full form');
    assert.equal(isPublicAddress(compress(groups)), expected, compress(groups));
    // dotted tail for the last 32 bits
    const tail = groups[6] * 65536 + groups[7];
    const withTail = `${groups.slice(0, 6).map(hex).join(':')}:${dotted(tail)}`;
    assert.equal(isPublicAddress(withTail), expected, withTail);
    // upper case spelling
    assert.equal(isPublicAddress(compress(groups).toUpperCase()), expected);
  }), { numRuns: 500 });
});

test('Property 1: anything that is not a clean address is refused', () => {
  fc.assert(fc.property(fc.string(), s => {
    // Random strings are almost never addresses; if net.isIP rejects them they must be false.
    if (!/^[0-9a-fA-F:.%]+$/.test(s)) assert.equal(isPublicAddress(s), false);
  }), { numRuns: 300 });
});

test('examples: well-known addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  for (const ip of [
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '255.255.255.255', '224.0.0.1', '198.18.0.1', '203.0.113.9',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::7f00:1', '64:ff9b::7f00:1',
    'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1', '2002:7f00:1::1',
    '2001:db8::1', '2001:0:1::1', '3fff::1', 'fe80::1%eth0', '',
    'not-an-ip', '1.2.3', '1.2.3.4.5', '01.2.3.4', '300.1.1.1', '::g', '1::2::3',
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress('::ffff:8.8.8.8'), true);
  assert.equal(isPublicAddress('64:ff9b::808:808'), true);
  assert.equal(isPublicAddress(undefined), false);
});
