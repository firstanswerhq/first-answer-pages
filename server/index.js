/**
 * index.js — entry point: checks startup requirements, then binds the
 * Express app to a port. Startup failures print one `[startup]` line and
 * exit with code 1 (no stack trace).
 */

import { startupProblems } from './lib/config.js';

const problems = startupProblems(process.env);
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`[startup] ${problem}\n`);
  process.exit(1);
}

try {
  const { default: app } = await import('./app.js');
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    process.stdout.write(`First Answer Pages listening on port ${port}\n`);
  });
} catch (err) {
  const message = String(err?.message ?? err).split('\n')[0];
  process.stderr.write(`[startup] ${message}\n`);
  process.exit(1);
}
