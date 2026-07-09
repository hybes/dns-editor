# DNS Manager

A self-hosted Cloudflare DNS control centre built with Nuxt 4 and Nuxt UI. It provides a focused interface for browsing zones, creating and editing DNS records, managing imports and exports, and accessing supported Cloudflare security tools.

## Requirements

- Node.js `22.13+`, `24.11+`, or `26+`
- npm 11+
- A Cloudflare API token with access to the accounts, zones, and features you intend to manage
- `OPENAI_API_KEY` only when using the optional AI DNS editor

The token entered in the UI is stored in the browser's local storage. Each operation sends it through this Nuxt server to Cloudflare; the server does not persist it. Self-host the app in an environment you trust.

## Setup

Install the exact dependency tree from the lockfile:

```bash
npm ci
```

Start the development server at `http://localhost:3000`:

```bash
npm run dev
```

## Validation

```bash
npm run lint
npm run build
```

The production build uses Nitro's Node server preset and retains the `server/api/*` routes that proxy Cloudflare requests.

## Production

Build and run locally:

```bash
npm run build
npm run start
```

Or build the included container:

```bash
docker build -t dns-manager .
docker run --rm -p 3000:3000 -e OPENAI_API_KEY dns-manager
```

Theme tokens live in [`app/assets/css/main.css`](app/assets/css/main.css), while Nuxt UI component defaults live in [`app/app.config.js`](app/app.config.js).

## Privacy and indexing

This is an authenticated operational tool, not a public website. The app emits both `robots` metadata and an `X-Robots-Tag` header to prevent indexing.
