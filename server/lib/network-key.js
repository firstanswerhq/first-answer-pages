/**
 * network-key.js — which network a visitor is on, for the per-network limit on new checks.
 *
 * IPv4: the first three parts ("203.0.113.7" gives "203.0.113").
 * IPv6: the first four groups of the expanded address, lower case, without leading zeros
 * ("2001:db8:1:2:aaaa::1" gives "2001:db8:1:2").
 * An IPv4 address written inside an IPv6 one ("::ffff:203.0.113.7") gives the IPv4 network.
 * Anything that is not an address gives the text itself, so unknown values are never lumped together.
 */

import net from 'node:net';

/** The eight 16-bit groups of an IPv6 address, or null when the text cannot be expanded. */
function expandV6(text) {
  let t = text.split('%')[0].toLowerCase(); // a zone such as "%eth0" is not part of the address
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(t);
  if (dotted) {
    const p = dotted[1].split('.').map(Number);
    t = `${t.slice(0, -dotted[1].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  let groups;
  if (t.includes('::')) {
    const [head, tail] = t.split('::');
    const h = head ? head.split(':') : [];
    const l = tail ? tail.split(':') : [];
    const fill = 8 - h.length - l.length;
    if (fill < 0) return null;
    groups = [...h, ...Array(fill).fill('0'), ...l];
  } else {
    groups = t.split(':');
  }
  if (groups.length !== 8) return null;
  const numbers = groups.map(g => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return numbers.some(Number.isNaN) ? null : numbers;
}

/**
 * @param {unknown} ip a client address as `req.ip` gives it
 * @returns {string} the network key
 */
export function networkKey(ip) {
  const text = String(ip ?? '').trim();
  const family = net.isIP(text);
  if (family === 4) return text.split('.').slice(0, 3).join('.');
  if (family === 6) {
    const groups = expandV6(text);
    if (!groups) return text;
    const mapped = groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff;
    if (mapped) return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8].join('.');
    return groups.slice(0, 4).map(g => g.toString(16)).join(':');
  }
  return text;
}
