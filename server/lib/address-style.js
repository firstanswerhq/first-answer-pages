/**
 * address-style.js — US style for an address shown on one line (V144).
 *
 * "410 Woodland St, Nashville, TN, 37206" reads "410 Woodland St, Nashville, TN 37206": no comma between the
 * state and the ZIP. Grades made before this rule keep the old text in storage, so this is applied when an
 * address is read from a Grade as well as when it is built.
 */

/**
 * @param {unknown} text
 * @returns {string}
 */
export function usAddressStyle(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/,\s*([A-Za-z]{2}),\s*(\d{5}(?:-\d{4})?)\s*$/, ', $1 $2');
}
