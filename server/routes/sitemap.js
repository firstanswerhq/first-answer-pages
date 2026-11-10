/**
 * sitemap.js — GET /sitemap.xml — XML sitemap
 */

import { Router } from 'express';
import { getListings } from '../data.js';
import { generateSitemap } from '../lib/sitemap.js';

const router = Router();

router.get('/sitemap.xml', (req, res) => {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  res.status(200).type('application/xml').send(generateSitemap(getListings(), baseUrl));
});

export default router;
