// Fix kit: copy-and-paste text built only from typed or found facts.
// All lengths count code points, not UTF-16 units.

const TITLE_MAX = 60;
const SUMMARY_MAX = 160;

const cp = s => Array.from(s);
const len = s => cp(s).length;
const tidy = v => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Cut to at most `max` code points at a word boundary (hard cut for one long word). */
function cutAtWord(s, max) {
  const chars = cp(s);
  if (chars.length <= max) return s;
  const head = chars.slice(0, max).join('');
  if (chars[max] === ' ') return head.trim();
  const i = head.lastIndexOf(' ');
  return (i > 0 ? head.slice(0, i) : head).trim();
}

function clean(found = {}) {
  return {
    name: tidy(found.name),
    service: tidy(found.service),
    city: tidy(found.city),
    state: tidy(found.state).toUpperCase(),
    phone: tidy(found.phone),
    website: tidy(found.website),
    address: tidy(found.address),
    hours: normalizeHours(found.hours),
  };
}

function normalizeHours(hours) {
  if (!hours) return [];
  if (typeof hours === 'string') return tidy(hours) ? [tidy(hours)] : [];
  if (Array.isArray(hours)) return hours.map(tidy).filter(Boolean);
  if (typeof hours === 'object') {
    return Object.entries(hours)
      .map(([day, v]) => (tidy(v) ? `${tidy(day)} ${tidy(v)}` : ''))
      .filter(Boolean);
  }
  return [];
}

function capitalizeFirst(s) {
  const chars = cp(s);
  if (!chars.length) return s;
  return chars[0].toUpperCase() + chars.slice(1).join('');
}

/** Lower-case a service for use in a sentence; words of 2+ letters in all caps stay as typed. */
function serviceInSentence(service) {
  return tidy(service)
    .split(' ')
    .map(w => (len(w) >= 2 && w === w.toUpperCase() && w !== w.toLowerCase() ? w : w.toLowerCase()))
    .join(' ');
}

function place(city, state) {
  if (city && state) return `${city}, ${state}`;
  return city || state;
}

export function suggestedTitle(found) {
  const f = clean(found);
  const tries = [];
  const words = f.service ? f.service.split(' ') : [];
  const withService = n => {
    const svc = capitalizeFirst(words.slice(0, n).join(' '));
    return `${f.name} | ${svc}${f.city ? ` in ${f.city}` : ''}`;
  };
  if (words.length) {
    tries.push(f.state && f.city ? `${withService(words.length)}, ${f.state}` : withService(words.length));
    if (f.state && f.city) tries.push(withService(words.length));
    for (let n = words.length - 1; n >= 1; n--) tries.push(withService(n));
  }
  tries.push(f.city ? `${f.name} | ${f.city}` : f.name);
  for (const t of tries) if (len(t) <= TITLE_MAX) return t;
  return cutAtWord(f.name, TITLE_MAX);
}

export function suggestedSummary(found) {
  const f = clean(found);
  const where = place(f.city, f.state);
  let s = f.name;
  if (f.service) s += `: ${serviceInSentence(f.service)}`;
  if (where) s += `${f.service ? ' in' : ':'} ${where}`;
  s += '.';
  if (f.phone) s += ` Call ${f.phone} today.`;
  if (f.city) {
    const extra = ` Serving ${f.city} and nearby areas.`;
    if (len(s + extra) <= SUMMARY_MAX) s += extra;
  }
  return cutAtWord(s, SUMMARY_MAX);
}

export function jsonLdBlock(found) {
  const f = clean(found);
  const data = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: f.name };
  if (f.phone) data.telephone = f.phone;
  if (f.website) data.url = f.website;
  // A business that goes to its customers ("no storefront") names its area and no address at all.
  const noStorefront = found?.noStorefront === true;
  if (!noStorefront && (f.address || f.city || f.state)) {
    const addr = { '@type': 'PostalAddress' };
    if (f.address) addr.streetAddress = f.address;
    if (f.city) addr.addressLocality = f.city;
    if (f.state) addr.addressRegion = f.state;
    data.address = addr;
  }
  if (f.hours.length) data.openingHours = f.hours;
  if (noStorefront) {
    if (f.city) data.areaServed = place(f.city, f.state);
  } else if (f.city) {
    data.areaServed = f.city;
  }
  // Built only from what the owner typed and the page showed: never a rating or a review.
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

export function llmsDraft(found) {
  const f = clean(found);
  const where = place(f.city, f.state);
  const lines = [`# ${f.name}`, ''];
  let summary = f.name;
  if (f.service) summary += `: ${serviceInSentence(f.service)}`;
  if (where) summary += `${f.service ? ' in' : ':'} ${where}`;
  lines.push(`> ${summary}.`, '');
  if (f.service) lines.push(`- Service: ${f.service}`);
  if (where) lines.push(`- Area: ${where}`);
  if (f.phone) lines.push(`- Phone: ${f.phone}`);
  if (f.website) lines.push(`- Website: ${f.website}`);
  if (f.hours.length) lines.push(`- Hours: ${f.hours.join('; ')}`);
  return lines.join('\n') + '\n';
}

export function robotsLines(blockedAgents) {
  const agents = [...new Set((blockedAgents || []).map(a => String(a)))]
    .filter(a => /^[A-Za-z0-9._-]+$/.test(a));
  return agents.map(a => `User-agent: ${a}\nAllow: /`).join('\n\n');
}
