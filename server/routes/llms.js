/**
 * llms.js — GET /llms.txt — plain-text AI feed
 */

import { Router } from 'express';
import { getListings } from '../data.js';
import { generateLlmsTxt } from '../lib/llms.js';

const router = Router();

router.get('/llms.txt', (req, res) => {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  res.status(200).type('text/plain').send(generateLlmsTxt(getListings(), baseUrl));
});

export default router;
