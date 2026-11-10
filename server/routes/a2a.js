/**
 * a2a.js — the A2A seam.
 *
 * mountA2A registers the Agent_Card route and the A2A endpoint route in one
 * call, so the card is never published without a live endpoint behind it.
 * Nothing in this spec supplies an `a2a` dependency, so the card path falls
 * through to the catch-all 404.
 */

export const AGENT_CARD_PATH = '/.well-known/agent-card.json';

/**
 * @param {import('express').Express} app
 * @param {{ card: object, path: string, handler: Function }} a2a
 */
export function mountA2A(app, a2a) {
  if (!a2a || typeof a2a.card !== 'object' || a2a.card === null) {
    throw new Error('mountA2A: a2a.card is required (card and endpoint must be enabled together)');
  }
  if (typeof a2a.path !== 'string' || !a2a.path.startsWith('/')) {
    throw new Error('mountA2A: a2a.path must be a string starting with "/"');
  }
  if (typeof a2a.handler !== 'function') {
    throw new Error('mountA2A: a2a.handler must be a function');
  }

  app.get(AGENT_CARD_PATH, (req, res) => res.json(a2a.card));
  app.post(a2a.path, a2a.handler);
}
