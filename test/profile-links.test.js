/**
 * high-tech-look Requirement 3.1 and 4.1: does a website link to the business's own profile on Yelp, Facebook,
 * Instagram, TikTok or Google? Only the links already on the page are read; nothing is fetched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectProfileLinks } from '../server/lib/profile-links.js';

const links = (...hrefs) => hrefs.map(href => ({ href, text: 'x' }));
const none = { yelp: null, facebook: null, instagram: null, tiktok: null, google: null };

test('no links, or something that is not a list, finds nothing', () => {
  assert.deepEqual(detectProfileLinks([]), none);
  assert.deepEqual(detectProfileLinks(undefined), none);
  assert.deepEqual(detectProfileLinks('x'), none);
  assert.deepEqual(detectProfileLinks([null, 5, {}, { href: 7 }]), none);
});

test('a link to the business\'s own page on each platform counts', () => {
  const found = detectProfileLinks(links(
    'https://www.yelp.com/biz/zephyr-plumbing-nashville',
    'https://www.facebook.com/ZephyrPlumbing',
    'https://www.instagram.com/zephyr.plumbing/',
    'https://www.tiktok.com/@zephyrplumbing',
    'https://www.google.com/maps/place/Zephyr+Plumbing/@36.1,-86.7,17z',
  ));
  assert.equal(found.yelp, 'https://www.yelp.com/biz/zephyr-plumbing-nashville');
  assert.equal(found.facebook, 'https://www.facebook.com/ZephyrPlumbing');
  assert.equal(found.instagram, 'https://www.instagram.com/zephyr.plumbing/');
  assert.equal(found.tiktok, 'https://www.tiktok.com/@zephyrplumbing');
  assert.ok(found.google.startsWith('https://www.google.com/maps/place/'));
});

test('share buttons, share intents, "sharer" links and links to a home page do not count', () => {
  assert.deepEqual(detectProfileLinks(links(
    'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fexample.com',
    'https://www.facebook.com/sharer.php?u=https://example.com',
    'https://www.facebook.com/share.php?u=https://example.com',
    'https://www.facebook.com/dialog/share?app_id=1',
    'https://www.facebook.com/plugins/like.php?href=x',
    'https://www.facebook.com/',
    'https://facebook.com',
    'https://www.instagram.com/',
    'https://www.instagram.com/p/Cabc123/',
    'https://www.instagram.com/explore/',
    'https://www.instagram.com/share?url=x',
    'https://www.tiktok.com/',
    'https://www.tiktok.com/share?url=x',
    'https://www.tiktok.com/embed.js',
    'https://www.yelp.com/',
    'https://www.yelp.com/writeareview/biz/abc',
    'https://www.yelp.com/biz_redir?url=x',
    'https://www.google.com/maps/dir/?api=1&destination=x',
    'https://www.google.com/search?q=zephyr',
    'https://twitter.com/intent/tweet?url=x',
  )), none);
});

test('tracking parameters, upper case, www. and m. hosts are handled', () => {
  const found = detectProfileLinks(links(
    'https://M.Facebook.com/ZephyrPlumbing?utm_source=site&fbclid=abc',
    'HTTPS://WWW.YELP.COM/BIZ/Zephyr-Plumbing?osq=plumber',
    'https://instagram.com/zephyr_plumbing?igshid=abc',
    'https://www.tiktok.com/@zephyr.plumbing?lang=en',
  ));
  assert.ok(found.facebook.toLowerCase().includes('facebook.com/zephyrplumbing'));
  assert.ok(found.yelp.toLowerCase().includes('yelp.com/biz/zephyr-plumbing'));
  assert.ok(found.instagram.includes('instagram.com/zephyr_plumbing'));
  assert.ok(found.tiktok.includes('tiktok.com/@zephyr.plumbing'));
});

test('Facebook pages written the other ways count, and Facebook\'s own pages do not', () => {
  assert.ok(detectProfileLinks(links('https://www.facebook.com/pages/Zephyr-Plumbing/123456789')).facebook);
  assert.ok(detectProfileLinks(links('https://www.facebook.com/profile.php?id=100012345678')).facebook);
  assert.ok(detectProfileLinks(links('https://fb.me/zephyrplumbing')).facebook);
  for (const path of ['groups/123', 'events/123', 'help', 'policies', 'login.php', 'watch', 'marketplace']) {
    assert.equal(detectProfileLinks(links(`https://www.facebook.com/${path}`)).facebook, null, path);
  }
  assert.equal(detectProfileLinks(links('https://www.facebook.com/profile.php')).facebook, null, 'no id');
});

test('a link to another site, a look-alike host or a relative link does not count', () => {
  assert.deepEqual(detectProfileLinks(links(
    'https://notfacebook.com/zephyr', 'https://facebook.com.evil.example/zephyr', 'https://example.com/facebook.com/zephyr',
    '/biz/zephyr', 'yelp.com/biz/zephyr', 'mailto:a@b.example', 'javascript:void(0)', 'tel:+16155550100', '#',
  )), none);
});

test('Google profile links: a place, a cid, a short link and g.page count; directions do not', () => {
  for (const href of [
    'https://maps.google.com/?cid=12345678901234567',
    'https://www.google.com/maps?cid=12345678901234567',
    'https://maps.app.goo.gl/AbCdEf123',
    'https://goo.gl/maps/AbCdEf123',
    'https://g.page/zephyr-plumbing',
    'https://g.page/r/AbCdEf123/review',
    'https://g.co/kgs/AbCdE',
  ]) {
    assert.ok(detectProfileLinks(links(href)).google, href);
  }
  assert.equal(detectProfileLinks(links('https://www.google.com/maps')).google, null);
  assert.equal(detectProfileLinks(links('https://www.google.com/')).google, null);
});

test('the first link to each platform wins, in page order', () => {
  const found = detectProfileLinks(links('https://facebook.com/first.page', 'https://facebook.com/second.page'));
  assert.equal(found.facebook, 'https://facebook.com/first.page');
});
