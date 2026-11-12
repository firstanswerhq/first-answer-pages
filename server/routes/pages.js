/**
 * pages.js — the plain public pages and robots.txt.
 *
 *   GET /about       what the site is, for owners and visitors
 *   GET /privacy     what we collect, why, how long, and how to ask for removal
 *   GET /robots.txt  crawl rules plus the sitemap address (Disallow: / in demo mode)
 *
 * The router also swaps the footer's contact marker on every HTML page for the
 * CONTACT_EMAIL line, or for nothing when CONTACT_EMAIL is not set. Mount it
 * before the other routers so the swap covers every page, 404s and errors.
 */

import { Router } from 'express';
import { layout, escapeHtml, CONTACT_MARKER } from '../lib/html.js';
import { baseUrlFor } from '../lib/base-url.js';
import { DEFAULT_SITE_NAME } from '../lib/config.js';

/** The contact sentence, or '' when there is no usable CONTACT_EMAIL. */
function contactLine(email) {
  return typeof email === 'string' && email.trim() !== ''
    ? `Questions? Email ${escapeHtml(email.trim())}.`
    : '';
}

/**
 * @param {{ config: object }} ctx
 * @returns {import('express').Router}
 */
export function createPagesRouter(ctx) {
  const router = Router();
  const config = ctx.config ?? {};
  const contact = contactLine(config.contactEmail);
  const footerContact = contact ? ` &middot; <span class="site-contact">${contact}</span>` : '';
  const contactPara = contact ? `\n<p class="site-contact">${contact}</p>` : '';
  // Never send people to "contact us" without an address to contact.
  const removalPara = contact
    ? '<p>To have a listing, quote request or email removed, contact us and we will delete it.</p>'
    : '<p>To have a listing, quote request or email removed, ask the business you contacted, or reply to any email from us.</p>';

  // Swap the footer marker in every HTML body (pages, 404s, errors).
  router.use((req, res, next) => {
    const send = res.send.bind(res);
    res.send = body => {
      // HTML only: JSON (API, MCP) passes through untouched, even if a listing contains the marker text.
      const type = String(res.get('Content-Type') ?? '');
      const isHtml = type.includes('html') || (!type && typeof body === 'string' && /^\s*<!doctype html/i.test(body));
      if (typeof body === 'string' && isHtml && body.includes(CONTACT_MARKER)) {
        body = body.split(CONTACT_MARKER).join(footerContact);
      }
      return send(body);
    };
    next();
  });

  router.get('/robots.txt', (req, res) => {
    const base = baseUrlFor(req, config);
    const lines = config.demoMode
      ? ['User-agent: *', 'Disallow: /']
      : ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /rise/drafts/'];
    lines.push('', `Sitemap: ${base}/sitemap.xml`, '');
    res.status(200).type('text/plain').send(lines.join('\n'));
  });

  router.get('/about', (req, res) => {
    const body = `<section class="message">
<h1>About ${DEFAULT_SITE_NAME}</h1>
<p>${DEFAULT_SITE_NAME} is a free local business directory, built so AI assistants like ChatGPT and Claude can read it and point people to real local businesses. Each listing has the business's phone number, services, service area and hours, written so both people and AI can understand it.</p>
<p>Business owners can list themselves free: snap a photo of a business card, flyer or sign, or type it in. We review every listing before it goes live. Visitors can call a business or send a quote request right from its page.</p>
<p><a href="/rise">List your business free &rarr;</a> &middot; <a href="/">Browse the directory</a></p>${contactPara}
</section>`;
    res.status(200).type('html').send(layout({
      title: `About | ${DEFAULT_SITE_NAME}`,
      body,
      canonical: `${baseUrlFor(req, config)}/about`,
      description: `${DEFAULT_SITE_NAME} is a free local business directory that AI assistants can read.`,
    }));
  });

  router.get('/privacy', (req, res) => {
    const body = `<section class="message">
<h1>Privacy</h1>
<p>This page explains, in plain words, what ${DEFAULT_SITE_NAME} collects and what we do with it.</p>
<h2>What we collect</h2>
<ul>
<li><strong>Business listings:</strong> the details an owner gives us, like the business name, phone, address, services, service area and hours. These are public once we approve the listing.</li>
<li><strong>An owner's email (optional):</strong> kept private and never shown on the site. We use it only to reach the owner about their listing and quote requests.</li>
<li><strong>Quote requests:</strong> the name, phone or email, and job details a visitor sends to a business. They are not shown on the site.</li>
<li><strong>AI visibility check (/grade):</strong> the business details a visitor types, what we read on that business's public website, and the AI answers we get. If a visitor opens the full report, we also keep the name, email and phone they give us. Reports are not listed in search engines.</li>
</ul>
<h2>Photos</h2>
<p>If an owner lists their business with a photo, the photo is read by Anthropic's Claude to fill in the listing. We never save the photo.</p>
<h2>How long we keep it</h2>
<ul>
<li>Quote requests are deleted after 180 days.</li>
<li>AI visibility check reports, and the contact details people give to open them, are deleted after 90 days.</li>
<li>Listing drafts that were never sent for review are deleted after 30 days.</li>
<li>Approved listings stay until the owner asks us to take them down.</li>
</ul>
<h2>What we never do</h2>
<p>We never sell your information, and we don't use it for advertising.</p>
<h2>Removal</h2>
${removalPara}${contactPara}
</section>`;
    res.status(200).type('html').send(layout({
      title: `Privacy | ${DEFAULT_SITE_NAME}`,
      body,
      canonical: `${baseUrlFor(req, config)}/privacy`,
      description: `What ${DEFAULT_SITE_NAME} collects, why, how long we keep it, and how to ask for removal.`,
    }));
  });

  return router;
}
