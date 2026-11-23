// The Grader's Checks and the website checks that run on a home page.
// Pure functions: facts, robots and llms results come in, Check_Results go out.

import {
  HOURS_PATTERN, STREET_PATTERN, CTA_PATTERN, hasReviewSignal, serviceAreaPattern, serviceAreaSource,
} from './page-facts.js';
import { AI_AGENTS, parseRobots, mayFetchRoot } from './robots.js';

const MAX_FIX = 160;

/**
 * The service-area fix, with the Grade's own city as the example ("your city" when it is empty). When the
 * sentence would pass 160 characters, the example is dropped rather than any word cut. Text, not HTML: it is
 * escaped where it is shown.
 * @param {{ city?: string }} [input]
 */
export function serviceAreaFix(input) {
  const city = typeof input?.city === 'string' && input.city.trim() !== '' ? input.city.trim() : 'your city';
  const withExample = `Add a line to your home page that names the area you serve, like "Serving ${city} and nearby areas".`;
  return Array.from(withExample).length <= MAX_FIX ? withExample : 'Add a line to your home page that names the area you serve.';
}

/**
 * Every Check. `points` add up to 100. `detail` text for a result comes from
 * `passText` / `failText` unless a check builds a more specific one.
 */
export const CHECKS = Object.freeze([
  {
    id: 'ai-bots-allowed', group: 'ai_readable', points: 8,
    label: 'Can AI assistants get in?',
    passText: 'Your website lets AI assistants read it.',
    failText: 'Your website tells some AI assistants to stay out.',
    fix: 'Your website tells some AI assistants to stay out. Replace the lines that block them in robots.txt with the lines in your fix kit.',
  },
  {
    id: 'business-labeled', group: 'ai_readable', points: 8,
    label: 'Business label for AI',
    passText: 'Your home page labels your business name and phone for AI.',
    failText: 'We found no readable business label with your name and phone.',
    fix: 'Add the business label block from your fix kit to your home page so AI can read your name and phone.',
  },
  {
    id: 'info-sheet', group: 'ai_readable', points: 4,
    label: 'Info sheet for AI',
    passText: 'We found an info sheet for AI (a file called llms.txt).',
    failText: 'We found no info sheet for AI (a file called llms.txt).',
    fix: 'Add a plain text file named llms.txt to your website. Your fix kit has a draft you can copy.',
  },
  {
    id: 'title-city-service', group: 'search_basics', points: 7,
    label: 'Page title',
    passText: 'Your title names your city and your service.',
    failText: 'Your title does not name both your city and your service.',
    fix: 'Change your page title to the one in your fix kit so it says what you do and where.',
  },
  {
    id: 'one-headline', group: 'search_basics', points: 4,
    label: 'Main headline on the home page',
    passText: 'Your home page has one main headline.',
    failText: 'Your home page should have exactly one main headline.',
    fix: 'Use exactly one main headline on your home page, and say what you do and where.',
  },
  {
    id: 'summary', group: 'search_basics', points: 4,
    label: 'Page summary',
    passText: 'Your page has a short summary of the right length.',
    failText: 'Your page summary is missing or not 50 to 170 characters.',
    fix: 'Add a short page summary of 50 to 170 characters. It is the text Google shows under your title. Your fix kit has one you can copy.',
  },
  {
    id: 'image-descriptions', group: 'search_basics', points: 3,
    label: 'Descriptions on your pictures',
    passText: 'Your pictures have descriptions.',
    failText: 'Too many of your pictures have no description.',
    fix: 'Add a short description to each picture on your home page, such as "Crew fixing a roof in Nashville".',
  },
  {
    id: 'share-picture', group: 'search_basics', points: 2,
    label: 'Picture for sharing your page',
    passText: 'Your page has a share picture.',
    failText: 'Your page has no share picture.',
    fix: 'Add a share picture to your home page, so a link to it shows a photo when someone shares it.',
  },
  {
    id: 'tap-to-call', group: 'customer_basics', points: 4,
    label: 'Tap-to-call phone number',
    passText: 'Your home page has a tap-to-call phone link.',
    failText: 'We found no tap-to-call phone link.',
    fix: 'Make your phone number a tap-to-call link so people on phones can call you in one tap.',
  },
  {
    id: 'hours-shown', group: 'customer_basics', points: 3,
    label: 'Hours on the home page',
    passText: 'Your home page shows your hours.',
    failText: 'We found no hours on your home page.',
    fix: 'Write your opening hours in plain text on your home page, for example "Mon-Fri 8am-5pm".',
  },
  {
    id: 'address-shown', group: 'customer_basics', points: 3,
    label: 'Street address on the home page',
    passText: 'Your home page shows a street address.',
    failText: 'We found no street address on your home page.',
    fix: 'Write your street address in plain text on your home page, or your service area if you travel to customers.',
    // Used instead when the owner ticked "We go to our customers (no storefront)". Same id, group and points.
    serviceArea: {
      label: 'Service area on the home page',
      passText: 'Your home page says what area you serve.',
      failText: 'We found no service area on your home page.',
      fix: serviceAreaFix,
    },
  },
  {
    id: 'call-button', group: 'customer_basics', points: 2,
    label: 'Call or book button on the home page',
    passText: 'Your home page has a call or book button.',
    failText: 'We found no call or book button or link.',
    fix: 'Add a clear button such as "Call now" or "Get a free estimate" near the top of your home page.',
  },
  {
    id: 'reviews-visible', group: 'customer_basics', points: 3,
    label: 'Can AI see your reviews?',
    passText: 'Your home page shows customer reviews that AI can read.',
    failText: "We found no customer reviews on your home page. AI assistants often can't see reviews that are only inside Google.",
    fix: "Put 3 or more of your real customer reviews on your home page, with each customer's first name and the date, and add a link to your Google reviews.",
  },
  {
    id: 'ai-named', group: 'ai_answers', points: 30,
    label: 'What AI says about your business',
    passText: 'An AI assistant named your business.',
    failText: 'An AI assistant did not name your business.',
    fix: "Claim your free listing and work through the fixes below. That gives AI more to read. It can take days to weeks, and we can't promise AI will name you.",
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

/**
 * A Check by id. With a Grade input whose `noStorefront` is true, a Check that has a service-area variant comes
 * back with that variant's label, texts and fix (a string, built from the Grade's own city).
 * @param {string} id
 * @param {{ noStorefront?: boolean, city?: string }} [input]
 */
export function checkById(id, input) {
  const check = CHECKS.find(c => c.id === id);
  if (!check || !check.serviceArea || input?.noStorefront !== true) return check;
  const v = check.serviceArea;
  return { ...check, label: v.label, passText: v.passText, failText: v.failText, fix: v.fix(input) };
}

// Plain names for the AI crawlers, so a blocked list reads "ChatGPT (GPTBot)", not just "GPTBot".
const AGENT_NAMES = Object.freeze({
  GPTBot: 'ChatGPT (GPTBot)',
  'OAI-SearchBot': 'ChatGPT search (OAI-SearchBot)',
  'ChatGPT-User': 'ChatGPT visitors (ChatGPT-User)',
  ClaudeBot: 'Claude (ClaudeBot)',
  'Claude-SearchBot': 'Claude search (Claude-SearchBot)',
  'Claude-User': 'Claude visitors (Claude-User)',
  PerplexityBot: 'Perplexity (PerplexityBot)',
  'Google-Extended': 'Google AI (Google-Extended)',
});

const TEXT_CHECKS = new Set(['one-headline', 'hours-shown', 'address-shown', 'call-button', 'reviews-visible']);
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

// Words in a typed service that say nothing about what the business does.
const SERVICE_FILLER = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'in', 'on', 'to', 'by', 'at', 'or', 'with',
  'service', 'services', 'company', 'companies', 'co', 'inc', 'llc', 'near', 'me',
]);

/** The title names the city and at least one word of the service, each as a whole word. */
function titleHasCityAndService(title, input) {
  const t = ` ${norm(title)} `;
  const city = norm(input?.city);
  if (!city || !t.includes(` ${city} `)) return false;
  const words = norm(input?.service).split(' ').filter(w => w.length >= 2 && !SERVICE_FILLER.has(w));
  return words.some(w => {
    const forms = new Set([w, `${w}s`]);
    if (w.length > 3 && w.endsWith('s')) forms.add(w.slice(0, -1));
    return [...forms].some(form => t.includes(` ${form} `));
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
  return result(id, 'fail', `Blocked: ${blocked.map(a => AGENT_NAMES[a] ?? a).join(', ')}.`, { blocked });
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
      // "Your 1 picture has no description." for a single picture; "2 of 5 pictures have no description." stays (V142).
  if (total === 1) return fail(id, 'Your 1 picture has no description.');
  return fail(id, `${missing} of ${total} pictures have no description.`);
    }
    case 'share-picture':
      return judge(id, Boolean(facts.ogImage));
    case 'tap-to-call':
      return judge(id, facts.telLinks.length > 0);
    case 'hours-shown':
      return judge(id, HOURS_PATTERN.test(facts.text));
    case 'address-shown': {
      if (input?.noStorefront !== true) return judge(id, STREET_PATTERN.test(facts.text));
      // No storefront: the service area counts, from the page text or the business label; a street address
      // alone neither passes nor fails it.
      const v = checkById(id, input);
      // Read before punctuation is taken out, so the "serving" window stops at the end of a sentence.
      const ok = serviceAreaPattern(input.city).test(serviceAreaSource(facts)) || Boolean(facts.jsonLd?.business?.areaServed);
      return ok ? result(id, 'pass', v.passText) : result(id, 'fail', v.failText);
    }
    case 'call-button':
      return judge(id, facts.ctaLabels.some(label => CTA_PATTERN.test(label)));
    case 'reviews-visible':
      // A review heading, a written rating or quoted comment, a link to reviews, or review data in the label.
      return judge(id, hasReviewSignal(facts));
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
