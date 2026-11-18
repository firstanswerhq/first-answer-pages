// Address guard for the safe fetcher: decides whether an IP address is a
// public, routable address. Anything unclear is refused.
import net from 'node:net';

// [base, prefix length] for every refused IPv4 range.
const V4_REFUSED = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0000200, 24], // 192.0.2.0/24
  [0xc0586300, 24], // 192.88.99.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xc6336400, 24], // 198.51.100.0/24
  [0xcb007100, 24], // 203.0.113.0/24
  [0xe0000000, 4], // 224.0.0.0/4
  [0xf0000000, 4], // 240.0.0.0/4
];

/** Parse a dotted IPv4 string to an unsigned 32-bit number, or null. */
function parseV4(text) {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n;
}

function v4InRange(n, base, bits) {
  const size = 2 ** (32 - bits);
  return Math.floor(n / size) === Math.floor(base / size);
}

function isPublicV4Number(n) {
  return !V4_REFUSED.some(([base, bits]) => v4InRange(n, base, bits));
}

/** Expand an IPv6 string to eight 16-bit groups, or null. */
function expandV6(text) {
  let work = text;
  const lastColon = work.lastIndexOf(':');
  const tail = work.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseV4(tail);
    if (v4 === null) return null;
    const hi = Math.floor(v4 / 65536).toString(16);
    const lo = (v4 % 65536).toString(16);
    work = `${work.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = work.split('::');
  if (halves.length > 2) return null;
  const toGroups = s => (s === '' ? [] : s.split(':'));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  let all;
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    all = [...head, ...Array(missing).fill('0'), ...rest];
  } else {
    all = head;
  }
  if (all.length !== 8) return null;
  const groups = [];
  for (const g of all) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  return groups;
}

function isPublicV6Groups(g) {
  const embedded = () => isPublicV4Number(g[6] * 65536 + g[7]);
  const zeroTo = n => g.slice(0, n).every(x => x === 0);

  if (zeroTo(5) && g[5] === 0xffff) return embedded(); // ::ffff:0:0/96
  if (zeroTo(6)) return embedded(); // ::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return embedded(); // 64:ff9b::/96

  if ((g[0] & 0xe000) !== 0x2000) return false; // outside 2000::/3
  if (g[0] === 0x2001 && g[1] < 0x0200) return false; // 2001::/23
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // 2001:db8::/32
  if (g[0] === 0x2002) return false; // 2002::/16
  if (g[0] === 0x3fff && g[1] < 0x1000) return false; // 3fff::/20
  return true;
}

/**
 * True only for a well-formed public IPv4 or IPv6 address.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPublicAddress(ip) {
  if (typeof ip !== 'string' || ip.includes('%')) return false;
  const family = net.isIP(ip);
  if (family === 4) {
    const n = parseV4(ip);
    return n !== null && isPublicV4Number(n);
  }
  if (family === 6) {
    const groups = expandV6(ip);
    return groups !== null && isPublicV6Groups(groups);
  }
  return false;
}
