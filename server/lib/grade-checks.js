/**
 * grade-checks.js — the 14 Checks and the website Check logic.
 *
 * runWebsiteChecks never invents a result: when something could not be read it
 * returns `not_checked` with a plain reason, never `fail`.
 */

import { normalizeForMatch } from './seance.js';
import { HOURS_PATTERN, STREET_PATTERN, CTA_PATTERN } from './page-facts.js';
import { parseRobots, mayFetchRoot, AI_AGENTS } from './robots.js';

export const GROUPS = Object.freeze({
  ai_answers: 'AI answers',
  ai_readable: 'Can AI read your site',
  search_basics: 'Search basics',
  customer_basics: 'Customer basics',
  google_profile: 'Google profile',
});

/** Fix sentences are at most 160 characters. Points total 100. */
export const CHECKS = Object.freeze([
  {
    id: 'ai-bots-allowed', group: 'ai_readable', points: 8,
    label: 'AI assistants are allowed in',
    passText: 'Your website lets AI assistants read it.',
    failText: 'Your website tells some AI assistants to stay out.',
    fix: "Your website tells some AI assistants to stay out. Your fix kit has the lines that let them in. They go in a file called robots.txt.",
  },
  {
    id: 'business-labeled', group: 'ai_readable', points: 8,
    label: 'Business label AI can read',
    passText: 'Your home page labels your business name and phone for AI.',
    failText: 'Your home page does not label your business name and phone in a way AI can read.',
    fix: 'Add the business label block from your fix kit to your home page so AI can read your name and phone.',
  },
  {
    id: 'info-sheet', group: 'ai_readable', points: 4,
    label: 'Info sheet for AI (llms.txt)',
    passText: 'Your website has an info sheet for AI (llms.txt).',
    failText: 'Your website has no info sheet for AI (llms.txt).',
    fix: "Add a plain text file named llms.txt in your website's main folder. Your fix kit has a draft.",
  },
  {
    id: 'title-city-service', group: 'search_basics', points: 7,
    label: 'Page title names your city and service',
    passText: 'Your page title says what you do and where.',
    failText: 'Your page title does not name both your city and your service.',
    fix: 'Change your page title to the one in your fix kit so it says what you do and where.',
  },
  {
    id: 'one-headline', group: 'search_basics', points: 4,
    label: 'One main headline',
    passText: 'Your home page has one main headline.',
    failText: 'Your home page should have exactly one main headline.',
    fix: 'Give your home page one main headline (an h1) that says what you do and where.',
  },
  {
    id: 'summary', group: 'search_basics', points: 4,
    label: 'Search summary',
    passText: 'Your page has a search summary of a good length.',
    failText: 'Your page has no search summary, or it is too short or too long.',
    fix: 'Add a short summary of your business that search engines show under your name. Your fix kit has one written for you.',
  },
  {
    id: 'image-descriptions', group: 'search_basics', points: 3,
    label: 'Picture descriptions',
    passText: 'Your pictures have descriptions.',
    failText: 'Many of your pictures have no description.',
    fix: 'Add a short description (alt text) to each picture, such as "Roof repair on a brick home".',
  },
  {
    id: 'share-picture', group: 'search_basics', points: 2,
    label: 'Share picture',
    passText: 'Your page has a picture for sharing.',
    failText: 'Your page has no picture for sharing.',
    fix: 'Add a share picture so links to your site show a photo when people text or post them.',
  },
  {
    id: 'tap-to-call', group: 'customer_basics', points: 5,
    label: 'Tap-to-call phone number',
    passText: 'Your phone number is a tap-to-call link.',
    failText: 'Your phone number is not a tap-to-call link.',
    fix: 'Make your phone number a tap-to-call link so people on phones can call you in one tap.',
  },
  {
    id: 'hours-shown', group: 'customer_basics', points: 4,
    label: 'Hours on the home page',
    passText: 'Your hours are on your home page.',
    failText: 'We could not find your hours on your home page.',
    fix: 'Put your hours on your home page as plain text, such as "Mon-Fri 8am-5pm".',
  },
  {
    id: 'address-shown', group: 'customer_basics', points: 3,
    label: 'Street address on the home page',
    passText: 'Your street address is on your home page.',
    failText: 'We could not find a street address on your home page.',
    fix: 'Put your street address on your home page as plain text. If you work at customers\' homes, say where you serve.',
  },
  {
    id: 'call-button', group: 'customer_basics', points: 3,
    label: 'Call or book button',
    passText: 'Your home page has a call or book button.',
    failText: 'We could not find a call or book button.',
    fix: 'Add a clear button such as "Call now" or "Get a free estimate" near the top of your home page.',
  },
  {
    id: 'ai-named', group: 'ai_answers', points: 30,
    label: 'Does AI name your business?',
    passText: 'Yes. An AI assistant named your business.',
    failText: 'No. AI assistants did not name your business.',
    fix: "Claim your free listing and work through the fixes below. That gives AI more to read. It can take days to weeks, and we can't promise AI will name you.",
  },
  {
    id: 'google-profile', group: 'google_profile', points: 15,
    label: 'Google business profile',
    passText: 'Your Google business profile looks complete.',
    failText: 'Your Google business profile needs work.',
    fix: 'Fill in your Google business profile with the same name, phone and hours as your website.',
  },
]);

const byId = Object.fromEntries(CHECKS.map(c => [c.id, c]));
export const checkById = id => byId[id];

const pass = (id, detail) => ({ id, result: 'pass', detail: detail ?? byId[id].passText });
const fail = (id, detail, extra = {}) => ({ id, result: 'fail', detail: detail ?? byId[id].failText, ...extra });
const notChecked = (id, detail) => ({ id, result: 'not_checked', detail });

/** The AI assistant behind each crawler name, for owner-facing text. */
const AGENT_OWNER = Object.freeze({
  GPTBot: 'ChatGPT', 'OAI-SearchBot': 'ChatGPT search', 'ChatGPT-User': 'ChatGPT',
  ClaudeBot: 'Claude', 'Claude-SearchBot': 'Claude search', 'Claude-User': 'Claude',
  PerplexityBot: 'Perplexity', 'Google-Extended': 'Google Gemini',
});
const plainAgent = agent => (AGENT_OWNER[agent] ? `${AGENT_OWNER[agent]} (${agent})` : agent);

const WEBSITE_IDS = CHECKS.filter(c => !['ai-named', 'google-profile'].includes(c.id)).map(c => c.id);
const TEXT_BASED = new Set(['one-headline', 'hours-shown', 'address-shown', 'call-button']);

const SCRIPT_BUILT_REASON = "your page loads its words in a way this check can't read yet";
const UNREACHABLE_REASON = "We couldn't reach your website.";

/** Words of 4 or more letters in the service (or every word when none is that long). */
function serviceWords(service) {
  const words = normalizeForMatch(service).split(' ').filter(Boolean);
  const long = words.filter(w => w.length >= 4);
  return long.length > 0 ? long : words;
}

function titleNamesCityAndService(title, input) {
  const t = ` ${normalizeForMatch(title)} `;
  const city = normalizeForMatch(input.city);
  if (city === '' || !t.includes(` ${city} `)) return false;
  return serviceWords(input.service).some(word => {
    const alt = word.endsWith('s') ? word.slice(0, -1) : `${word}s`;
    return t.includes(` ${word} `) || t.includes(` ${alt} `);
  });
}

const codePoints = text => Array.from(text).length;

/**
 * @param {{
 *   facts: object|null,
 *   robots: { status: number, text?: string }|null,
 *   llms: { status: number, contentType?: string, text?: string }|null,
 *   input: { city: string, service: string, website: string|null },
 *   failure?: string,
 * }} args
 * @returns {{ id: string, result: 'pass'|'fail'|'not_checked', detail: string }[]}
 */
export function runWebsiteChecks({ facts, robots, llms, input, failure }) {
  const google = notChecked('google-profile', 'Google check coming soon');
  if (!input?.website) {
    return [...WEBSITE_IDS.map(id => notChecked(id, 'No website given')), google];
  }
  const homeReason = failure || UNREACHABLE_REASON;
  const out = [];

  // ai-bots-allowed
  if (!robots) out.push(notChecked('ai-bots-allowed', "We couldn't read your robots.txt."));
  else if (robots.status === 404 || robots.status === 410) {
    out.push(pass('ai-bots-allowed', 'You have no robots.txt, so nothing is blocked.'));
  } else if (robots.status === 200) {
    const groups = parseRobots(robots.text ?? '');
    const blocked = AI_AGENTS.filter(agent => !mayFetchRoot(groups, agent));
    out.push(blocked.length === 0
      ? pass('ai-bots-allowed')
      : fail('ai-bots-allowed', `Blocked: ${blocked.map(plainAgent).join(', ')}.`, { blocked }));
  } else out.push(notChecked('ai-bots-allowed', "We couldn't read your robots.txt."));

  // Checks that read the home page
  const home = (id, test, details = {}) => {
    if (!facts) return notChecked(id, homeReason);
    if (TEXT_BASED.has(id) && facts.scriptBuilt) return notChecked(id, SCRIPT_BUILT_REASON);
    const verdict = test(facts);
    return verdict === true ? pass(id) : fail(id, typeof verdict === 'string' ? verdict : details.fail);
  };

  out.push(home('business-labeled', f => {
    const b = f.jsonLd.business;
    if (b && b.name && b.telephone) return true;
    if (f.jsonLd.unreadableCount > 0 && !b) return "Your website has a behind-the-scenes label that tells AI your business name and phone. Yours has a mistake, so AI cannot read it.";
    if (b) return 'Your business label is missing your name or phone.';
    return 'We found no business label on your home page.';
  }));

  // info-sheet
  if (!llms) out.push(notChecked('info-sheet', "We couldn't check for an llms.txt file."));
  else {
    const isHtml = /html/i.test(llms.contentType ?? '');
    const present = llms.status === 200 && !isHtml && (llms.text ?? '').trim().length >= 20;
    out.push(present ? pass('info-sheet') : fail('info-sheet'));
  }

  out.push(home('title-city-service', f => (f.title === ''
    ? 'Your page has no title.'
    : titleNamesCityAndService(f.title, input) || `Your title is "${f.title}".`)));
  out.push(home('one-headline', f => {
    if (f.h1s.length === 1 && f.h1s[0] !== '') return true;
    if (f.h1s.length === 0) return 'We found no main headline.';
    if (f.h1s.length > 1) return `We found ${f.h1s.length} main headlines.`;
    return 'Your main headline is empty.';
  }));
  out.push(home('summary', f => {
    const n = codePoints(f.metaDescription);
    if (n >= 50 && n <= 170) return true;
    return n === 0 ? 'We found no search summary.' : `Your search summary is ${n} characters. Aim for 50 to 170.`;
  }));
  out.push(home('image-descriptions', f => {
    if (f.imgCount === 0) return true;
    const described = f.imgCount - f.imgMissingAlt;
    return described / f.imgCount >= 0.8
      || `${f.imgMissingAlt} of ${f.imgCount} pictures have no description.`;
  }));
  out.push(home('share-picture', f => f.ogImage !== ''));
  out.push(home('tap-to-call', f => f.telLinks.length > 0));
  out.push(home('hours-shown', f => HOURS_PATTERN.test(f.text)));
  out.push(home('address-shown', f => STREET_PATTERN.test(f.text)));
  out.push(home('call-button', f => f.ctaLabels.some(label => CTA_PATTERN.test(label))));

  out.push(google);
  return out;
}
