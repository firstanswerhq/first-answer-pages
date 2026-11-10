/**
 * Hand-written validator for the small JSON Schema subset the MCP tools use:
 * type (object, string), properties, required, additionalProperties: false,
 * minLength, maxLength. Plus semantic validation for request_quote.
 *
 * Both functions are total: they accept any JavaScript value and never throw.
 */

export const SEARCH_LISTINGS_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', maxLength: 200 },
    city: { type: 'string', maxLength: 200 },
    query: { type: 'string', maxLength: 200 },
  },
  additionalProperties: false,
};

export const GET_LISTING_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
  },
  required: ['id'],
  additionalProperties: false,
};

// Quote string limits are generous here on purpose. The real limits apply to
// the sanitized, trimmed values in validateQuoteArgs.
export const REQUEST_QUOTE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
    name: { type: 'string', minLength: 1, maxLength: 1000 },
    contact: { type: 'string', minLength: 1, maxLength: 1000 },
    details: { type: 'string', minLength: 1, maxLength: 10000 },
  },
  required: ['id', 'name', 'contact', 'details'],
  additionalProperties: false,
};

const ARGUMENTS = 'arguments';
const EMPTY_CONTACT_MESSAGE = 'Please enter a phone number or email.';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(argument, message) {
  return { ok: false, argument, message };
}

function checkString(schema, name, value) {
  if (typeof value !== 'string') return fail(name, `${name} must be a string`);
  if (Object.hasOwn(schema, 'minLength') && value.length < schema.minLength) {
    if (name === 'contact') return fail(name, EMPTY_CONTACT_MESSAGE);
    return fail(name, `${name} must be at least ${schema.minLength} characters`);
  }
  if (Object.hasOwn(schema, 'maxLength') && value.length > schema.maxLength) {
    return fail(name, `${name} must be at most ${schema.maxLength} characters`);
  }
  return null;
}

/**
 * @param {object} schema
 * @param {unknown} value
 * @returns {{ok: true, value: unknown} | {ok: false, argument: string, message: string}}
 */
export function validateAgainstSchema(schema, value) {
  try {
    if (!isPlainObject(schema)) return fail(ARGUMENTS, 'invalid schema');

    if (schema.type === 'string') {
      const err = checkString(schema, ARGUMENTS, value);
      return err ?? { ok: true, value };
    }

    if (!isPlainObject(value)) return fail(ARGUMENTS, 'arguments must be an object');

    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];

    for (const key of required) {
      if (!Object.hasOwn(value, key)) return fail(key, `${key} is required`);
    }

    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        if (schema.additionalProperties === false) {
          return fail(key, `${key} is not an allowed argument`);
        }
        continue;
      }
      const sub = properties[key];
      if (sub && sub.type === 'string') {
        const err = checkString(sub, key, value[key]);
        if (err) return err;
      }
    }

    return { ok: true, value };
  } catch {
    return fail(ARGUMENTS, 'arguments could not be validated');
  }
}

// Control characters: C0, DEL, and C1.
const CONTROL_ALL = /[\u0000-\u001F\u007F-\u009F]/g;
// Same, but keeps \t (0x09) and \n (0x0A).
const CONTROL_KEEP_TAB_NL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

function sanitizeLine(text) {
  return text.replace(CONTROL_ALL, '').trim();
}

function sanitizeMultiline(text) {
  return text.replace(/\r\n/g, '\n').replace(CONTROL_KEEP_TAB_NL, '').trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS_RE = /^[\d\s().+-]+$/;

function isEmail(contact) {
  return contact.length <= 254 && EMAIL_RE.test(contact);
}

function isPhone(contact) {
  if (!PHONE_CHARS_RE.test(contact)) return false;
  const digits = contact.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

/**
 * @param {unknown} args
 * @param {{findById: (id: string) => object | undefined}} store
 * @returns {{ok: true, value: {id: string, name: string, contact: string, details: string}}
 *   | {ok: false, argument: string, message: string}}
 */
export function validateQuoteArgs(args, store) {
  try {
    const structural = validateAgainstSchema(REQUEST_QUOTE_SCHEMA, args);
    if (!structural.ok) return structural;

    const id = sanitizeLine(args.id);
    const name = sanitizeLine(args.name);
    const contact = sanitizeLine(args.contact);
    const details = sanitizeMultiline(args.details);

    if (id.length === 0 || !store || typeof store.findById !== 'function' || !store.findById(id)) {
      return fail('id', 'id does not match a published listing');
    }
    if (name.length < 1 || name.length > 100) {
      return fail('name', 'name must be 1 to 100 characters');
    }
    if (contact.length === 0) return fail('contact', EMPTY_CONTACT_MESSAGE);
    if (!isEmail(contact) && !isPhone(contact)) {
      return fail('contact', 'contact must be an email address or a phone number');
    }
    if (details.length < 1 || details.length > 2000) {
      return fail('details', 'details must be 1 to 2000 characters');
    }

    return { ok: true, value: { id, name, contact, details } };
  } catch {
    return fail(ARGUMENTS, 'arguments could not be validated');
  }
}
