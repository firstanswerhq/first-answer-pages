// The Grader's Checks and the website checks that run on a home page.
// Pure functions: facts, robots and llms results come in, Check_Results go out.

import { HOURS_PATTERN, STREET_PATTERN, CTA_PATTERN } from './page-facts.js';
import { AI_AGENTS, parseRobots, mayFetchRoot } from './robots.js';

/**
 * Every Check. `points` add up to 100. `detail` text for a result comes from
 * `passText` / `failText` unless a check builds a more specific one.
 */
export const CHECKS = Object.freeze([
  {
    id: 'ai-bots-allowed', group: 'ai_readable', points: 8,
    label: 'AI assistants may read your website',
    passText: 'Your website lets AI assistants read it.',
    failText: 'Your website tells some AI assistants to stay out.',
    fix: 'Your website tells some AI assistants to stay out. Add the lines in your fix kit to robots.txt so they can read it.',
  },
  {
    id: 'business-labeled', group: 'ai_readable', points: 8,
    label: 'Your business is labeled for AI',
    passText: 'Your home page labels your business name and phone for AI.',
    failText: 'We found no readable business label with your name and phone.',
    fix: 'Add the business label block from your fix kit to your home page so AI can read your name and phone.',
  },
  {
    id: 'info-sheet', group: 'ai_readable', points: 4,
    label: 'You have an info sheet for AI (llms.txt)',
    passText: 'We found an llms.txt info sheet.',
    failText: 'We found no llms.txt info sheet.',
    fix: 'Add a plain text file named llms.txt to your website. Your fix kit has a draft you can copy.',
  },
  {
    id: 'title-city-service', group: 'search_basics', points: 7,
    label: 'Your page title says what you do and where',
    passText: 'Your title names your city and your service.',
    failText: 'Your title does not name both your city and your service.',
    fix: 'Change your page title to the one in your fix kit so it says what you do and where.',
  },
  {
    id: 'one-headline', group: 'search_basics', points: 4,
    label: 'Your home page has one main headline',
    passText: 'Your home page has one main headline.',
    failText: 'Your home page should have exactly one main headline.',
    fix: 'Use exactly one main headline (h1) on your home page, and say what you do and where.',
  },
  {
    id: 'summary', group: 'search_basics', points: 4,
    label: 'Your page has a short summary',
    passText: 'Your page has a short summary of the right length.',
    failText: 'Your page summary is missing or not 50 to 170 characters.',
    fix: 'Add a page summary (meta description) of 50 to 170 characters. Your fix kit has one you can copy.',
  },
  {
    id: 'image-descriptions', group: 'search_basics', points: 3,
    label: 'Your pictures have descriptions',
    passText: 'Your pictures have descriptions.',
    failText: 'Too many of your pictures have no description.',
    fix: 'Add a short description (alt text) to each picture on your home page, such as "Crew fixing a roof in Nashville".',
  },
  {
    id: 'share-picture', group: 'search_basics', points: 2,
    label: 'Your page has a share picture',
    passText: 'Your page has a share picture.',
    failText: 'Your page has no share picture.',
    fix: 'Add a share picture (og:image) to your home page so links to it show a photo.',
  },
  {
    id: 'tap-to-call', group: 'customer_basics', points: 5,
    label: 'Your phone number is tap-to-call',
    passText: 'Your home page has a tap-to-call phone link.',
    failText: 'We found no tap-to-call phone link.',
    fix: 'Make your phone number a tap-to-call link so people on phones can call you in one tap.',
  },
  {
    id: 'hours-shown', group: 'customer_basics', points: 4,
    label: 'Your hours are on your home page',
    passText: 'Your home page shows your hours.',
    failText: 'We found no hours on your home page.',
    fix: 'Write your opening hours in plain text on your home page, for example "Mon-Fri 8am-5pm".',
  },
  {
    id: 'address-shown', group: 'customer_basics', points: 3,
    label: 'Your street address is on your home page',
    passText: 'Your home page shows a street address.',
    failText: 'We found no street address on your home page.',
    fix: 'Write your street address in plain text on your home page, or your service area if you travel to customers.',
  },
  {
    id: 'call-button', group: 'customer_basics', points: 3,
    label: 'Your home page has a call or book button',
    passText: 'Your home page has a call or book button.',
    failText: 'We found no call or book button or link.',
    fix: 'Add a clear button such as "Call now" or "Get a free estimate" near the top of your home page.',
  },
  {
    id: 'ai-named', group: 'ai_answers', points: 30,
    label: 'AI assistants name your business',
    passText: 'An AI assistant named your business.',
    failText: 'An AI assistant did not name your business.',
    fix: 'Give AI more to read: a free listing, a labeled home page and an info sheet. AI assistants pick up changes over days to weeks.',
  },
  {
    id: 'google-profile', group: 'google_profile', points: 15,
    label: 'Your Google profile',
    passText: 'Your Google profile looks complete.',
    failText: 'Your Google profile needs work.',
    fix: 'Claim and fill in your Google Business Profile with your hours, phone and services.',
  },
]);

/**
 * The report's groups, in the order they are shown. `show: false` keeps a group out
 * of the report (the Google check is not built in version one).
 */
export const GROUPS = Object.freeze([
  { id: 'ai_answers', label: 'AI answers', show: true },
  { id: 'ai_readable', label: 'Can AI read your website', show: true },
  { id: 'search_basics', label: 'Search basics', show: true },
  { id: 'customer_basics', label: 'Customer basics', show: true },
  { id: 'google_profile', label: 'Your Google profile', show: false },
]);

/** @param {string} id */
export function checkById(id) {
  return CHECKS.find(c => c.id === id);
}

const TEXT_CHECKS = new Set(['one-headline', 'hours-shown', 'address-shown', 'call-button']);
const SCRIPT_BUILT_REASON = "Your page loads its words in a way this check can't read yet.";
const NO_WEBSITE = 'No website given';
const UNREACHED = "We couldn't reach your website.";

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function result(id, res, detail, extra) {
  return { id, result: res, detail, ...extra };
}

function pass(id) {
  return result(id, 'pass', checkById(id).passText);
}

function fail(id, detail) {
  return result(id, 'fail', detail || checkById(id).failText);
}

function notChecked(id, reason) {
  return result(id, 'not_checked', reason);
}

function judge(id, ok, detail) {
  return ok ? pass(id) : fail(id, detail);
}

function titleHasCityAndService(title, input) {
  const t = ` ${norm(title)} `;
  const city = norm(input?.city);
  if (!city || !t.includes(` ${city} `)) return false;
  const words = norm(input?.service).split(' ').filter(w => w.length >= 4);
  return words.some(w => {
    const singular = w.endsWith('s') && w.length > 4 ? w.slice(0, -1) : w;
    return t.includes(w) || t.includes(singular);
  });
}

function looksLikeHtml(contentType, text) {
  if (/html/i.test(String(contentType ?? ''))) return true;
  return /^\s*(?:<!doctype\s+html|<html)/i.test(String(text ?? '').slice(0, 200));
}

function checkRobots(robots, reason) {
  const id = 'ai-bots-allowed';
  if (!robots || typeof robots.status !== 'number') return notChecked(id, reason);
  if (robots.status === 404 || robots.status === 410) return result(id, 'pass', checkById(id).passText, { blocked: [] });
  if (robots.status !== 200) return notChecked(id, "We couldn't read your robots.txt file.");
  const groups = parseRobots(String(robots.text ?? ''));
  const blocked = AI_AGENTS.filter(agent => !mayFetchRoot(groups, agent));
  if (blocked.length === 0) return result(id, 'pass', checkById(id).passText, { blocked });
  return result(id, 'fail', `Blocked: ${blocked.join(', ')}.`, { blocked });
}

function checkLlms(llms, reason) {
  const id = 'info-sheet';
  if (!llms || typeof llms.status !== 'number') return notChecked(id, reason);
  const text = String(llms.text ?? '');
  const present = llms.status === 200 && !looksLikeHtml(llms.contentType, text) && text.trim().length >= 20;
  return judge(id, present);
}

function checkFacts(id, facts, input) {
  switch (id) {
    case 'title-city-service':
      return judge(id, titleHasCityAndService(facts.title, input),
        facts.title ? `Your title is "${facts.title}".` : 'We found no page title.');
    case 'business-labeled': {
      const b = facts.jsonLd?.business;
      if (b && b.name && b.telephone) return pass(id);
      return fail(id, facts.jsonLd?.unreadableCount > 0
        ? "We found a business label block but couldn't read it."
        : 'We found no readable business label with your name and phone.');
    }
    case 'one-headline': {
      const n = facts.h1s.length;
      if (n === 1) return pass(id);
      return fail(id, n === 0 ? 'We found no main headline.' : `We found ${n} main headlines.`);
    }
    case 'summary': {
      const len = Array.from(facts.metaDescription || '').length;
      if (len >= 50 && len <= 170) return pass(id);
      return fail(id, len === 0 ? 'We found no page summary.' : `Your page summary is ${len} characters.`);
    }
    case 'image-descriptions': {
      const total = facts.imgCount;
      const missing = facts.imgMissingAlt;
      if (total === 0 || (total - missing) / total >= 0.8) return pass(id);
      return fail(id, `${missing} of ${total} pictures have no description.`);
    }
    case 'share-picture':
      return judge(id, Boolean(facts.ogImage));
    case 'tap-to-call':
      return judge(id, facts.telLinks.length > 0);
    case 'hours-shown':
      return judge(id, HOURS_PATTERN.test(facts.text));
    case 'address-shown':
      return judge(id, STREET_PATTERN.test(facts.text));
    case 'call-button':
      return judge(id, facts.ctaLabels.some(label => CTA_PATTERN.test(label)));
    default:
      return notChecked(id, UNREACHED);
  }
}

/**
 * Runs the website Checks (every Check except `ai-named`).
 * @param {object} args
 * @param {object|null} args.facts Page_Facts, or null when the page could not be read
 * @param {{status:number,text?:string}|null} args.robots
 * @param {{status:number,text?:string,contentType?:string}|null} args.llms
 * @param {{city?:string,service?:string,website?:string|null}} args.input
 * @param {string} [args.failure] plain reason the page could not be read
 * @returns {object[]} Check_Results
 */
export function runWebsiteChecks({ facts, robots, llms, input, failure } = {}) {
  const google = notChecked('google-profile', 'Google check coming soon');
  const ids = CHECKS.map(c => c.id).filter(id => id !== 'ai-named' && id !== 'google-profile');

  if (!input?.website) {
    return [...ids.map(id => notChecked(id, NO_WEBSITE)), google];
  }

  const reason = failure || UNREACHED;
  const out = ids.map(id => {
    if (id === 'ai-bots-allowed') return checkRobots(robots, reason);
    if (id === 'info-sheet') return checkLlms(llms, reason);
    if (!facts) return notChecked(id, reason);
    if (facts.scriptBuilt && TEXT_CHECKS.has(id)) return notChecked(id, SCRIPT_BUILT_REASON);
    return checkFacts(id, facts, input);
  });
  out.push(google);
  return out;
}
