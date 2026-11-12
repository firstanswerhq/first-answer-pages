# Technology Decisions

## Runtime

- **Node.js 22** — use built-in APIs where available (fetch, node:test, etc.)

## Server

- **Express** — plain Express, no meta-frameworks (no Next.js, no Fastify, no Hono)
- Hand-written routes and middleware only
- No code generators, no scaffolding tools

## Frontend

- **Plain HTML** — server-rendered templates (no JSX, no template engine required beyond simple string interpolation or a minimal templating helper if needed)
- **Plain CSS** — hand-crafted styles only, no Tailwind, no Bootstrap, no CSS-in-JS
- **Vanilla JavaScript** — no React, no Vue, no Svelte, no Alpine, no jQuery
- No bundlers (no Webpack, no Vite, no Rollup, no esbuild)
- No transpilers (no Babel, no TypeScript)
- Browser JS is optional and minimal — the site must work without JavaScript enabled

## Language

- **Plain JavaScript (.js files)** — no TypeScript
- ES modules (`"type": "module"` in package.json) preferred
- JSDoc comments for documentation where helpful, but not required

## Storage

- **JSON files in `data/`** — no database server, no ORM, no query language
- One JSON file per collection (e.g., `data/listings.json`, `data/categories.json`)
- Seeds (`listings.json`, `categories.json`) are read-only. Reads are served from an in-memory snapshot.
- The web layer writes only the allow-listed collections (`drafts`, `pending`, `quotes`, `seance`, `grades`, `leads`, plus `published.json` and `verified.json` on approval), only through `server/lib/json-file.js`.

## Testing

- **node:test** — Node's built-in test runner (no Jest, no Mocha, no Vitest)
- **fast-check** — property-based testing library (the one approved third-party test dependency)
- Test files live in `test/` and follow the naming pattern `*.test.js`
- Run tests with: `node --test`

## Dependencies Policy

- Minimize third-party dependencies
- Every dependency must be justified — prefer Node built-ins
- Approved production dependencies: `express`
- Approved dev/test dependencies: `fast-check`
- No CSS frameworks, no UI component libraries, no utility libraries (lodash, etc.)

## No-Go List

The following are explicitly off the table — do not introduce them:

- React, Vue, Svelte, Angular, or any component framework
- Next.js, Nuxt, Remix, or any meta-framework
- TypeScript or any compile-to-JS language
- Webpack, Vite, Rollup, Parcel, esbuild, or any bundler
- Tailwind, Bootstrap, Material UI, or any CSS framework
- Prisma, Drizzle, Sequelize, or any ORM
- PostgreSQL, MySQL, MongoDB, SQLite, or any database server
- Jest, Mocha, Chai, Vitest, or any third-party test runner
