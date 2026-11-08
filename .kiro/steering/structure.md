# Project Directory Structure

## Layout

```
first-answer-pages/
├── package.json          # project metadata, scripts, dependencies
├── README.md             # project overview and local dev instructions
├── .gitignore
│
├── server/               # Express application
│   ├── app.js            # Express app setup, middleware registration
│   ├── index.js          # entry point — binds to port and starts server
│   └── routes/           # one file per route group
│       ├── home.js       # GET / — home page
│       ├── listings.js   # GET /listings/:id — individual listing pages
│       ├── api.js        # GET /api/listings/:id — JSON API endpoints
│       ├── llms.js       # GET /llms.txt — plain-text AI feed
│       └── sitemap.js    # GET /sitemap.xml — XML sitemap
│
├── public/               # static assets served by Express
│   ├── css/
│   │   └── style.css     # all hand-crafted styles
│   ├── js/               # optional minimal client-side JS (progressive enhancement)
│   └── images/           # any static images or icons
│
├── data/                 # JSON data files — source of truth for all listings
│   ├── listings.json     # array of all business listing objects
│   └── categories.json   # array of category names/slugs
│
├── test/                 # all test files
│   ├── listings.test.js  # unit tests for listing data helpers
│   ├── api.test.js       # integration tests for JSON API routes
│   ├── llms.test.js      # tests for /llms.txt generation
│   ├── sitemap.test.js   # tests for sitemap.xml generation
│   └── schema.test.js    # property-based tests for JSON-LD schema generation
│
└── mcp/                  # MCP server for AI tool integrations (future)
    └── index.js          # MCP server entry point (placeholder)
```

## Rules

- All server-side code lives under `server/`. Nothing in the root runs at request time.
- All test files live under `test/`. No test files alongside source files.
- `data/` contains only JSON. No code, no scripts in `data/`.
- `public/` is served statically. No server logic in `public/`.
- `mcp/` is a future placeholder — do not wire it into the main server in v1.
- The root contains only config/meta files: `package.json`, `README.md`, `.gitignore`, and similar.
