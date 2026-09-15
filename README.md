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

## Using the app

Sign in with a Cloudflare API token. The app checks the token with Cloudflare before saving it; **Replace token** in the account menu at the bottom of the sidebar swaps it later.

- The **sidebar** lists your zones through a zone switcher and shows the current zone's pages: **Overview** (status, name servers, SSL/TLS mode and Bot Fight Mode), **Records**, and, when the token allows, **Rules** and **Analytics**. Turnstile, DNS Views and DNS Firewall apply to the whole account, so they appear under the zone's account name.
- **⌘K** (Ctrl+K) searches zones, pages, tools and actions.
- **Records** are created and edited in a side panel over the table, so filters and scroll position stay put. A record's URL (`/zones/<zone>/records/<record>`) opens the same panel.

Pages render in the browser (`ssr: false`); the Nitro server only serves the `/api` routes that proxy Cloudflare.

## Tools

Three utilities sit outside any zone under **Tools** in the sidebar:

- **DNS Lookup** (`/tools/dns-lookup`) queries Cloudflare's and Google's public resolvers over DNS-over-HTTPS and shows the answers side by side, with TTLs, DNSSEC validation and a resolvers-agree check. Entering an IP address runs a reverse lookup. The records page's **More** menu opens the tool pre-filled with that zone.
- **Propagation Check** (`/tools/propagation`) asks the zone's own nameservers and 15 public resolvers (Cloudflare, Google, Quad9, OpenDNS and others across several countries) for a record over plain DNS, then reports which resolvers already return the expected value or match the nameservers, how long stale caches have left, and whether the nameservers agree with each other. Record rows have a **Check propagation** action that opens the tool pre-filled; proxied records compare against the nameservers because their public answer is Cloudflare's edge.
- **Domain Search** (`/tools/domain-search`) checks whether a name is registered across a chosen set of endings using each registry's RDAP service (bootstrapped from IANA), falls back to a public-resolver NS query where a registry publishes no RDAP, shows Porkbun's public first-year price as a reference figure, and links to Cloudflare Registrar, Porkbun and Namecheap to buy. Names that already exist as zones on the token are flagged.

These tools contact third-party services from this server: the resolvers, the relevant registry's RDAP endpoint, IANA and Porkbun receive only the names being looked up, never the Cloudflare token. The propagation check needs outbound UDP/TCP port 53 from wherever the app is hosted, and it won't query name server addresses in private, loopback or link-local ranges. Purchases always complete on the registrar's own site.

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
