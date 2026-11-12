# Project Directory Structure

## Layout

```
first-answer-pages/
├── package.json          # project metadata, scripts, dependencies
├── README.md             # project overview and local dev instructions
├── render.yaml           # Render deploy settings
├── .gitignore
│
├── server/               # Express application
│   ├── app.js            # createApp(deps): builds ctx, mounts routers
│   ├── index.js          # entry point: binds to port and starts server
│   ├── data.js           # data store (listings, drafts, quotes, grades, ...)
│   ├── lib/              # all helpers: config, html, drafts, assistant, seance,
│   │                     # rate-limiter, ai-budget, notifier, retention, mcp, and
│   │                     # (grader) ip-guard, safe-fetch, page-facts, robots,
│   │                     # grade-checks, grade-score, name-match, fix-kit,
│   │                     # grader, grade-html
│   └── routes/           # one file per route group (home, listings, api, llms,
│                         # sitemap, rise, mcp, seance, admin, pages, a2a, grade)
│
├── public/               # static assets served by Express
│   ├── css/style.css     # all hand-crafted styles
│   ├── js/               # optional minimal client-side JS (progressive enhancement)
│   └── images/
│
├── data/                 # JSON only: seeds (listings.json, categories.json) and,
│                         # when DATA_DIR is unset, the writable collections
│
├── docs/                 # notes (for example launch-fixes.md)
├── test/                 # all test files (*.test.js), fixtures in test/fixtures/
├── mcp/                  # stdio MCP server entry point (built; not wired into the web server)
└── .kiro/                # specs, steering, hooks
```

## Rules

- All server-side code lives under `server/`. Nothing in the root runs at request time.
- All test files live under `test/`. No test files alongside source files.
- `data/` contains only JSON. No code, no scripts in `data/`.
- `public/` is served statically. No server logic in `public/`.
- The web layer may write only to these allow-listed collections, through the data store's JSON-file writer: `drafts`, `pending`, `quotes`, `seance`, `grades`, `leads` (plus `published.json` and `verified.json` on admin approval).
- The root contains only config/meta files: `package.json`, `README.md`, `render.yaml`, `.gitignore`, and similar.
