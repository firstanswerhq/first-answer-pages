// Fix kit: copy-and-paste text built only from typed or found facts.
// All lengths count code points, not UTF-16 units.

import { stripAddressTail } from './schema.js';
import { usAddressStyle } from './address-style.js';

const TITLE_MAX = 60;
const SUMMARY_MAX = 160;
/** What the business label holds for the phone when none was found on the page (V137). */
export const PHONE_PLACEHOLDER = 'ADD YOUR PHONE NUMBER';

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
  // The service is shown whole or not at all, and the state stays while the city is shown (V118): a shorter
  // try leaves the service out rather than cutting it mid-phrase ("… | Window cleaning and pressure in …").
  if (f.service) {
    const svc = capitalizeFirst(f.service);
    tries.push(`${f.name} | ${svc}${f.city ? ` in ${place(f.city, f.state)}` : ''}`);
  }
  if (f.city && f.state) tries.push(`${f.name} | ${f.city}, ${f.state}`);
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

/** Placeholders the report's kit puts in for a street or ZIP it couldn't read (batch 5 K13). */
export const STREET_PLACEHOLDER = 'ADD YOUR STREET ADDRESS';
export const ZIP_PLACEHOLDER = 'ADD YOUR ZIP CODE';
/** The line shown above a block that holds a placeholder (K13). */
export const REPLACE_CAPITALS = 'Replace the CAPITAL WORDS before pasting.';

/** True when a built block still holds a placeholder the owner must replace. */
export const hasPlaceholder = text => [PHONE_PLACEHOLDER, STREET_PLACEHOLDER, ZIP_PLACEHOLDER].some(p => String(text).includes(p));

/**
 * The business label (schema.org LocalBusiness markup). `options.placeholders` (the report's kit, K13) puts plain
 * placeholders in for a street and ZIP that couldn't be read, never an invented value. `found.sameAs` is a list of the
 * business's own profile addresses that the check found linked from its website.
 */
export function jsonLdBlock(found, options = {}) {
  const f = clean(found);
  const data = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: f.name };
  // No phone found: a plain placeholder the owner must replace (never an invented number) (V137).
  data.telephone = f.phone || PHONE_PLACEHOLDER;
  if (f.website) data.url = f.website;
  // A business that goes to its customers ("no storefront") names its area and no address at all.
  const noStorefront = found?.noStorefront === true;
  if (!noStorefront && (f.address || f.city || f.state || options.placeholders)) {
    const addr = { '@type': 'PostalAddress' };
    // Only the street goes in streetAddress; the city, state and ZIP each have their own field (V144).
    const whole = usAddressStyle(f.address);
    const street = stripAddressTail(whole, f.city, f.state);
    const zip = street !== whole ? /\b(\d{5}(?:-\d{4})?)\s*$/.exec(whole)?.[1] : undefined;
    if (street) addr.streetAddress = street;
    else if (options.placeholders) addr.streetAddress = STREET_PLACEHOLDER;
    if (f.city) addr.addressLocality = f.city;
    if (f.state) addr.addressRegion = f.state;
    if (zip) addr.postalCode = zip;
    else if (options.placeholders) addr.postalCode = ZIP_PLACEHOLDER;
    data.address = addr;
  }
  if (f.hours.length) data.openingHours = f.hours;
  if (noStorefront) {
    if (f.city) data.areaServed = place(f.city, f.state);
  } else if (f.city) {
    data.areaServed = f.city;
  }
  const sameAs = [...new Set((Array.isArray(found?.sameAs) ? found.sameAs : [])
    .map(u => String(u ?? '').trim()).filter(u => /^https:\/\/[^\s"<>]+$/i.test(u)))];
  if (sameAs.length > 0) data.sameAs = sameAs;
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
