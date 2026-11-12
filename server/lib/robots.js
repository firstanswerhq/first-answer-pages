/**
 * robots.js — reads robots.txt and answers whether an agent may fetch "/".
 *
 * Groups that name the same agent are merged. Within the chosen rules, the
 * longest matching path wins and Allow wins a tie. An empty "Disallow:" allows
 * everything.
 */

/** The AI crawlers the Grader checks. */
export const AI_AGENTS = Object.freeze([
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Google-Extended',
]);

/** @typedef {{ agents: string[], rules: { allow: boolean, path: string }[] }} Group */

/**
 * @param {string} text
 * @returns {Group[]}
 */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasRule = false;
  const source = typeof text === 'string' ? text.replace(/^\uFEFF/, '') : '';
  for (const rawLine of source.split(/\r?\n/)) {
    const hash = rawLine.indexOf('#');
    const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || lastWasRule) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasRule = false;
    } else if (field === 'allow' || field === 'disallow') {
      if (!current) continue; // a rule before any user-agent line is ignored
      current.rules.push({ allow: field === 'allow', path: value });
      lastWasRule = true;
    }
    // unknown fields (sitemap, crawl-delay, ...) are ignored
  }
  return groups;
}

/** Paths that match the site root "/". Returns the rule's weight, or -1. */
function rootWeight(rule) {
  const { allow, path } = rule;
  if (path === '') return allow ? -1 : 0; // empty Disallow allows everything; empty Allow is a no-op
  if (['/', '/*', '*', '/$', '*$'].includes(path)) return path.length;
  return -1;
}

/**
 * @param {Group[]} groups
 * @param {string} agent
 * @returns {boolean} true when the agent may fetch "/"
 */
export function mayFetchRoot(groups, agent) {
  const name = String(agent).toLowerCase();
  let chosen = groups.filter(g => g.agents.includes(name));
  if (chosen.length === 0) chosen = groups.filter(g => g.agents.includes('*'));
  if (chosen.length === 0) return true;

  let best = null; // { weight, allow }
  for (const group of chosen) {
    for (const rule of group.rules) {
      let weight = rootWeight(rule);
      let allow = rule.allow;
      if (rule.path === '' && !rule.allow) { weight = 0; allow = true; } // empty Disallow
      if (weight < 0) continue;
      if (best === null || weight > best.weight || (weight === best.weight && allow && !best.allow)) {
        best = { weight, allow };
      }
    }
  }
  return best === null ? true : best.allow;
}
