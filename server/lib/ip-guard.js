/**
 * ip-guard.js — decides whether an IP address is safe to connect to.
 *
 * isPublicAddress(ip) is true only for globally routable addresses. Anything
 * that net.isIP rejects, any string with a zone id (%), and any string the
 * expander cannot parse is NOT public. Never loosen these rules.
 */

import net from 'node:net';

/** Refused IPv4 ranges as [dotted base, prefix length]. */
export const REFUSED_IPV4 = Object.freeze([
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4], // includes 255.255.255.255
]);

/** Dotted quad -> unsigned 32-bit number, or null when malformed. */
function parseIPv4(text) {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const RANGES = REFUSED_IPV4.map(([base, bits]) => {
  const start = parseIPv4(base);
  const size = 2 ** (32 - bits);
  return [start, start + size - 1];
});

function ipv4NumberIsPublic(n) {
  return !RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

/** IPv6 text -> eight 16-bit groups, or null when it cannot be parsed. */
function expandIPv6(text) {
  if (text.includes('%')) return null;
  let head = text;
  let tail = [];
  // Embedded dotted IPv4 tail becomes two groups.
  const lastColon = text.lastIndexOf(':');
  if (lastColon === -1) return null;
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseIPv4(last);
    if (v4 === null) return null;
    tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    head = text.slice(0, lastColon + 1);
    if (head.endsWith('::')) {
      // keep "::" as is
    } else {
      head = head.slice(0, -1);
    }
  }
  const groupsOf = s => (s === '' ? [] : s.split(':'));
  const parse = list => {
    const out = [];
    for (const g of list) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const dbl = head.indexOf('::');
  let groups;
  if (dbl === -1) {
    const left = parse(groupsOf(head));
    if (!left) return null;
    groups = [...left, ...tail];
  } else {
    if (head.indexOf('::', dbl + 1) !== -1 || head.includes(':::')) return null;
    const left = parse(groupsOf(head.slice(0, dbl)));
    const right = parse(groupsOf(head.slice(dbl + 2)));
    if (!left || !right) return null;
    const fill = 8 - left.length - right.length - tail.length;
    if (fill < 1) return null;
    groups = [...left, ...new Array(fill).fill(0), ...right, ...tail];
  }
  return groups.length === 8 ? groups : null;
}

function ipv6IsPublic(g) {
  const embedded = (g[6] * 65536 + g[7]);
  const zeroTo = n => g.slice(0, n).every(x => x === 0);
  // ::ffff:0:0/96 (IPv4-mapped) and ::/96 (IPv4-compatible, also :: and ::1)
  if (zeroTo(5) && g[5] === 0xffff) return ipv4NumberIsPublic(embedded);
  if (zeroTo(6)) return ipv4NumberIsPublic(embedded);
  // 64:ff9b::/96 (NAT64)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) {
    return ipv4NumberIsPublic(embedded);
  }
  // Native IPv6 is public only inside 2000::/3 ...
  if ((g[0] & 0xe000) !== 0x2000) return false;
  // ... minus these blocks.
  if (g[0] === 0x2001 && g[1] < 0x0200) return false; // 2001::/23
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // 2001:db8::/32
  if (g[0] === 0x2002) return false; // 2002::/16 (6to4)
  if (g[0] === 0x3fff && g[1] < 0x1000) return false; // 3fff::/20
  return true;
}

/**
 * @param {string} ip
 * @returns {boolean} true only for a well-formed, globally routable address
 */
export function isPublicAddress(ip) {
  if (typeof ip !== 'string') return false;
  const kind = net.isIP(ip);
  if (kind === 4) {
    const n = parseIPv4(ip);
    return n !== null && ipv4NumberIsPublic(n);
  }
  if (kind === 6) {
    const groups = expandIPv6(ip);
    return groups !== null && ipv6IsPublic(groups);
  }
  return false;
}
