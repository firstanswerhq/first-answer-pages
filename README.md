# first-answer-pages
The old phone book, resurrected for AI. Free local business listings that AI assistants can read and recommend. Built with Kiro for Kiroween 2026.

First Answer Pages is a free local business directory with a classic phone-book look. Every listing has a plain HTML page, a JSON API entry, and a line in a plain-text feed (`/llms.txt`) so people and AI assistants can read it. It is part of First Answer (firstanswerhq.com).

## Install

Requires Node.js 22.

```
npm install
```

## Run

```
npm start
```

Then open http://localhost:3000.

Routes:
- `GET /` directory home page (optional `?category=` and `?city=` filters)
- `GET /listings/:id` one listing page, with JSON-LD
- `GET /api/listings/:id` one listing as JSON
- `GET /llms.txt` plain-text feed of all listings
- `GET /sitemap.xml` XML sitemap

## Test

```
node --test
```

## Environment variables

- `PORT` port to listen on (default `3000`)
- `BASE_URL` public site address used in `/llms.txt` and `/sitemap.xml` (default `http://localhost:3000`)

## Data

Listings live in `data/listings.json` and categories in `data/categories.json`. They are read once at startup. Each listing has an id, name, category, phone, hours, services, service area, description, city, state, and an optional address.

The seed data is fictional. The businesses, names, and phone numbers are made up for development and demonstration only.

## License

MIT. See `LICENSE`.
