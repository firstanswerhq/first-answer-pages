// Upload helpers for the /rise owner listing page: image signature detection and
// strict base64 decoding. Pure functions over Buffers; nothing touches disk.

export const MAX_IMAGE_BYTES = 5242880; // 5 MiB decoded image
export const MAX_FORM_BYTES = 8 * 1024 * 1024; // 8 MiB encoded form body
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Identify an image by its leading bytes.
 * @param {Uint8Array|Buffer} bytes
 * @returns {'image/jpeg'|'image/png'|'image/webp'|null}
 */
export function detectImageType(bytes) {
  if (!bytes || typeof bytes.length !== 'number') return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  // WebP: "RIFF" at 0-3, "WEBP" at 8-11
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return null;
}

const DATA_URL_PREFIX = /^data:[^,]*;base64,/i;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decode base64 text (optionally a data URL) to a Buffer.
 * Whitespace is ignored. Returns null for empty or invalid input.
 * @param {unknown} text
 * @returns {Buffer|null}
 */
export function decodeBase64Image(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim().replace(DATA_URL_PREFIX, '');
  s = s.replace(/\s+/g, '');
  if (s.length === 0 || s.length % 4 !== 0) return null;
  if (!BASE64_BODY.test(s)) return null;
  const buf = Buffer.from(s, 'base64');
  return buf.length === 0 ? null : buf;
}
