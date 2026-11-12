/**
 * fix-kit.js — copy-and-paste fixes for the business's own website.
 *
 * Every function uses only facts the visitor typed or the scan found. Lengths
 * count code points. Output is plain text: pages escape it when they show it.
 */

const clean = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const len = text => Array.from(text).length;
const titleCase = text => text.split(' ').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

/** Cut to at most `max` code points at a word boundary; hard-cut a single long word. */
function cutAtWord(text, max) {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max);
  // Cut only at a word boundary when the next character starts a new word.
  if (chars[max] === ' ') return head.join('').trim();
  const lastSpace = head.lastIndexOf(' ');
  if (lastSpace > 0) return head.slice(0, lastSpace).join('').trim();
  return head.join('');
}

const stateCode = state => clean(state).toUpperCase().slice(0, 2);

/**
 * `<name> | <Service> in <City>, <ST>`, shortened to 60 characters without
 * cutting a word in half (unless a single word is longer than 60).
 */
export function suggestedTitle({ name, service, city, state }) {
  const n = clean(name);
  const s = titleCase(clean(service));
  const c = clean(city);
  const st = stateCode(state);
  const fits = text => len(text) <= 60;

  if (s && c && st) {
    const full = `${n} | ${s} in ${c}, ${st}`;
    if (fits(full)) return full;
  }
  if (s && c) {
    const noState = `${n} | ${s} in ${c}`;
    if (fits(noState)) return noState;
    const words = s.split(' ');
    for (let k = words.length - 1; k >= 1; k -= 1) {
      const trimmed = `${n} | ${words.slice(0, k).join(' ')} in ${c}`;
      if (fits(trimmed)) return trimmed;
    }
  }
  if (c) {
    const cityOnly = `${n} | ${c}`;
    if (fits(cityOnly)) return cityOnly;
  }
  return cutAtWord(n, 60);
}

/** Up to 160 characters, built from the name, service, city and (when found) the phone. */
export function suggestedSummary({ name, service, city, state, phone }) {
  const n = clean(name);
  const s = clean(service).toLowerCase();
  const c = clean(city);
  const st = stateCode(state);
  const place = c && st ? `${c}, ${st}` : c;
  let text = n;
  if (s && place) text += `: ${s} in ${place}.`;
  else if (place) text += `: ${place}.`;
  else text += '.';
  const p = clean(phone);
  if (p) text += ` Call ${p} today.`;
  if (c) {
    const extra = ` Serving ${c} and nearby areas.`;
    if (len(text + extra) <= 160) text += extra;
  }
  return cutAtWord(text, 160);
}

/** A LocalBusiness JSON-LD script block. `<` is escaped so the page can't be broken out of. */
export function jsonLdBlock(found) {
  const data = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: clean(found.name) };
  if (clean(found.phone)) data.telephone = clean(found.phone);
  if (clean(found.website)) data.url = clean(found.website);
  const address = { '@type': 'PostalAddress' };
  if (clean(found.address)) address.streetAddress = clean(found.address);
  if (clean(found.city)) address.addressLocality = clean(found.city);
  if (stateCode(found.state)) address.addressRegion = stateCode(found.state);
  if (Object.keys(address).length > 1) data.address = address;
  const hours = (Array.isArray(found.hours) ? found.hours : []).map(clean).filter(Boolean);
  if (hours.length > 0) data.openingHours = hours;
  if (clean(found.city)) data.areaServed = clean(found.city);
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

/** A plain-text llms.txt draft in Markdown. */
export function llmsDraft(found) {
  const name = clean(found.name);
  const service = clean(found.service);
  const city = clean(found.city);
  const st = stateCode(found.state);
  const place = city && st ? `${city}, ${st}` : city;
  const lines = [`# ${name}`, ''];
  if (service && place) lines.push(`> ${name} offers ${service.toLowerCase()} in ${place}.`, '');
  if (service) lines.push(`- Service: ${service}`);
  if (place) lines.push(`- Area: ${place}`);
  if (clean(found.phone)) lines.push(`- Phone: ${clean(found.phone)}`);
  if (clean(found.website)) lines.push(`- Website: ${clean(found.website)}`);
  const hours = (Array.isArray(found.hours) ? found.hours : []).map(clean).filter(Boolean);
  if (hours.length > 0) lines.push(`- Hours: ${hours.join('; ')}`);
  return `${lines.join('\n')}\n`;
}

/** robots.txt lines that let each blocked AI crawler in. */
export function robotsLines(blockedAgents) {
  const agents = (Array.isArray(blockedAgents) ? blockedAgents : [])
    .filter(a => typeof a === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(a));
  return agents.map(a => `User-agent: ${a}\nAllow: /`).join('\n\n');
}
