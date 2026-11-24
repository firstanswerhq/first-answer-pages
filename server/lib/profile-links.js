/**
 * profile-links.js: does a website link to the business's own profile on Yelp, Facebook, Instagram, TikTok or Google?
 * (high-tech-look Requirement 3.1 and checklist F1, F3, F4.)
 *
 * Only the links already on the page are read. Nothing is fetched. Share buttons, share intents, "sharer" links and
 * links to a platform's home page do not count. Tracking parameters, upper case, and www. or m. hosts are handled.
 */

/** The platform's host without www. or m. (and a few other mobile prefixes). */
function bareHost(url) {
  return url.hostname.toLowerCase().replace(/^(?:www|m|mobile|touch|web)\./, '');
}

function parse(href) {
  if (typeof href !== 'string') return null;
  try {
    // A relative address resolves to a host that is no platform, so it never counts.
    const url = new URL(href.trim(), 'https://page.invalid/');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

const segments = url => url.pathname.split('/').filter(Boolean);

const FACEBOOK_NOT_A_PAGE = new Set([
  'sharer', 'sharer.php', 'share', 'share.php', 'dialog', 'plugins', 'tr', 'login', 'login.php', 'recover', 'help',
  'policies', 'privacy', 'legal', 'about', 'ads', 'business', 'events', 'groups', 'marketplace', 'watch', 'gaming',
  'hashtag', 'search', 'stories', 'reel', 'reels', 'l.php', 'flx', 'public', 'photo', 'photo.php', 'permalink.php',
  'story.php', 'video', 'videos', 'home.php', 'friends', 'settings', 'notifications', 'messages', 'fundraisers',
  'places', 'pages', 'people', 'profile.php',
]);

const INSTAGRAM_NOT_A_PROFILE = new Set([
  'p', 'reel', 'reels', 'tv', 'explore', 'accounts', 'about', 'legal', 'developer', 'direct', 'stories', 'share',
  'web', 'directory', 'challenge', 'oauth',
]);

/** A Yelp business page: yelp.com/biz/<name>. Not the home page, a review-writing link or a redirect. */
function isYelp(url) {
  if (bareHost(url) !== 'yelp.com') return false;
  const seg = segments(url);
  return seg[0]?.toLowerCase() === 'biz' && Boolean(seg[1]);
}

/** A Facebook page: facebook.com/<name>, /pages/<name>/<id>, /people/<name>/<id> or profile.php?id=. */
function isFacebook(url) {
  const host = bareHost(url);
  if (host !== 'facebook.com' && host !== 'fb.com' && host !== 'fb.me') return false;
  const seg = segments(url);
  if (seg.length === 0) return false;
  const first = seg[0].toLowerCase();
  if (first === 'profile.php') return /^\d{5,}$/.test(url.searchParams.get('id') ?? '');
  if (first === 'pages' || first === 'people') return seg.length >= 3;
  if (FACEBOOK_NOT_A_PAGE.has(first)) return false;
  return /^[a-z0-9.\-]{3,}$/i.test(seg[0]);
}

/** An Instagram profile: instagram.com/<name>. Not a post, a reel, the explore page or a share link. */
function isInstagram(url) {
  if (bareHost(url) !== 'instagram.com') return false;
  const seg = segments(url);
  if (seg.length === 0) return false;
  if (INSTAGRAM_NOT_A_PROFILE.has(seg[0].toLowerCase())) return false;
  return /^[a-z0-9._]{1,30}$/i.test(seg[0]);
}

/** A TikTok profile: tiktok.com/@<name>. Not the home page, a share link or an embed. */
function isTikTok(url) {
  if (bareHost(url) !== 'tiktok.com') return false;
  const first = segments(url)[0] ?? '';
  return /^@[a-z0-9._]{2,}$/i.test(first);
}

/** The business's Google profile: a Google Maps place or cid link, a g.page link, or Google's short links. */
function isGoogleProfile(url) {
  const host = bareHost(url);
  const seg = segments(url);
  if (host === 'g.page') return seg.length > 0 && seg[0].toLowerCase() !== 'r' ? true : seg.length > 1;
  if (host === 'maps.app.goo.gl') return seg.length > 0;
  if (host === 'goo.gl') return seg[0]?.toLowerCase() === 'maps' && seg.length > 1;
  if (host === 'g.co') return seg[0]?.toLowerCase() === 'kgs' && seg.length > 1;
  if (host === 'google.com' || host === 'maps.google.com') {
    const first = seg[0]?.toLowerCase();
    if (host === 'google.com' && first !== 'maps') return false;
    if (seg[1]?.toLowerCase() === 'place' && seg.length > 2) return true;
    if (seg[0]?.toLowerCase() === 'place' && seg.length > 1) return true;
    return /^\d{5,}$/.test(url.searchParams.get('cid') ?? '');
  }
  return false;
}

/**
 * The first link to each profile, or null.
 * @param {Array<{ href: string }> | undefined} links the page's links (`facts.links`)
 * @returns {{ yelp: string|null, facebook: string|null, instagram: string|null, tiktok: string|null, google: string|null }}
 */
export function detectProfileLinks(links) {
  const out = { yelp: null, facebook: null, instagram: null, tiktok: null, google: null };
  for (const link of Array.isArray(links) ? links : []) {
    const url = parse(link?.href);
    if (!url) continue;
    if (!out.yelp && isYelp(url)) out.yelp = url.href;
    else if (!out.facebook && isFacebook(url)) out.facebook = url.href;
    else if (!out.instagram && isInstagram(url)) out.instagram = url.href;
    else if (!out.tiktok && isTikTok(url)) out.tiktok = url.href;
    else if (!out.google && isGoogleProfile(url)) out.google = url.href;
  }
  return out;
}
