/**
 * index.js — entry point: binds the Express app to a port
 */

import app from './app.js';

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  process.stdout.write(`First Answer Pages listening on port ${port}\n`);
});
