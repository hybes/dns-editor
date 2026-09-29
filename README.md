# DNS Manager

A self-hosted Cloudflare DNS control centre built with Nuxt 4 and Nuxt UI. It provides a focused interface for browsing zones, creating and editing DNS records, managing imports and exports, and accessing supported Cloudflare security tools. Every Cloudflare API call goes through the command catalogue of [cf](https://github.com/cloudflare/cf), Cloudflare's CLI, and a **Console** runs any of cf's 2,889 API commands from the browser.

## Requirements

- Node.js `22.13+`, `24.11+`, or `26+`
- npm 11+
- A Cloudflare API token with access to the accounts, zones, and features you intend to manage
- `OPENAI_API_KEY` only when using the optional AI DNS editor
- Git, only to move to a newer cf release (`npm run cf:sync`)

People sign in with a DNS Manager account (a username and password). Each account adds its own Cloudflare API tokens, called connections, which the server stores in a SQLite database, encrypted with AES-256-GCM, and never sends back to the browser. Passwords are stored as scrypt hashes, and sessions are HttpOnly cookies. Anyone who can reach the site can create an account, and each account only sees the connections it adds. Self-host the app in an environment you trust.

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

Create an account on the sign-up page, then add a Cloudflare connection. **Cloudflare connections** in the account menu at the bottom of the sidebar lists them, and adds, renames or removes them. With several connections, such as one per Cloudflare login, their zones appear together, and each request uses the connection that can see the zone or account it's about. **Your account** changes the password, which also signs out the account's other sessions.

The easiest way to get a token is to let the app make one. **Create a set-up token in Cloudflare** on the connections page opens Cloudflare's token form with the one permission that needs (User API Tokens Edit, as in Cloudflare's **Create Additional Tokens** template); create it and paste it on the connections page. The app then offers to create a token called DNS Manager for all your accounts and zones, with either every permission its pages use or every Cloudflare permission (for the Console), adds it as a connection and deletes the one-off token. The permissions it asks for are listed in [`shared/utils/cloudflare.js`](shared/utils/cloudflare.js) and matched to Cloudflare's permission groups by name when the token is made. The connections page also has a link that fills in Cloudflare's token form, for choosing permissions by hand.

- The **sidebar** lists your zones through a zone switcher and shows the current zone's pages. A page the token can't use because of a missing permission, or because R2 isn't turned on, shows with a lock, and opening it says what to change; pages your plan doesn't include are left out.
    - **Overview**: status, name servers, DNSSEC status, SSL/TLS mode and Bot Fight Mode.
    - **Records**: the zone's DNS records, with import and export of BIND zone files, a record scan and the zone's record quota.
    - **DNSSEC**: turn DNSSEC on or off, the DS record and DNSKEY fields your registrar asks for with copy buttons, multi-signer, pre-signed and NSEC3 settings, and the zone signing keys.
    - **DNS settings**: CNAME flattening, multi-provider DNS, name server type and TTL, the SOA record, zone mode and secondary overrides.
    - **Zone transfers**: Cloudflare as a secondary (incoming transfers, with "Transfer now") and as a primary (outgoing transfers, on or off, with "Notify secondaries now").
    - **Zone settings**: 23 common settings for HTTPS and TLS, network, security, and caching and speed, each saved as you change it.
    - **Files**: an R2 bucket for the zone's own files, named after the zone (`example.com` uses `example-com`) in the zone's account, so each domain's files stay apart. Create the bucket from the page, then browse folders, upload (up to 100 MB a file), download, delete, and optionally make the files public on an r2.dev address or a subdomain of the zone. It needs R2 turned on for the account and Workers R2 Storage Edit on the token.
    - **Rules** and **Analytics**.
- Turnstile, DNS Views, DNS Firewall and **Transfer peers** (the peers, TSIG keys and ACLs zone transfers use) apply to the whole account, so they appear under the zone's account name.
- **Zones** lists every zone the token can see. For domains registered with Cloudflare Registrar it also shows the renewal date, an auto-renew switch and the renewal price, and can sort by renewal date. Registrations carry no price, so the price is Cloudflare's quote for the domain, or its current price for a standard name on the same ending, which the page says.
- **Registrar** (`/registrar`) lists an account's Cloudflare Registrar domains with their status, expiry and auto-renew, shows each registration's details and any workflow in progress, and registers new domains. It needs a token with Cloudflare Registrar permissions for the account.
- **Usage and billing** (`/usage`) shows, for one account and period: metered usage by product from Cloudflare's billable usage API (which Cloudflare marks as alpha), each R2 bucket's storage and Class A and B operations with the zones' buckets linked to their Files pages, the account's subscriptions, and its billing history with receipt downloads. Each part needs its own permission (Billing Read, Workers R2 Storage and Account Analytics Read) and loads on its own.
- **Sharing** (`/sharing`) gives other DNS Manager accounts access to some of your domains, as described below.
- **⌘K** (Ctrl+K) searches zones, pages, tools and actions.
- **Records** are created and edited in a side panel over the table, so filters and scroll position stay put. A record's URL (`/zones/<zone>/records/<record>`) opens the same panel. **Scan for records** in the **More** menu, and in an empty zone, asks Cloudflare to look up common records at the domain's current DNS provider; nothing is added until you accept it.

Pages render in the browser (`ssr: false`); the Nitro server only serves the `/api` routes that proxy Cloudflare.

## Sharing domains

**Share domains** on the Sharing page picks some of your domains, a level for each area of them (DNS records, analytics, DNSSEC and DNS settings, zone settings, rules, files, and renewals) and whether the person sees renewal prices. Levels are **No access**, **View**, **Edit** and, where it applies, **Edit and delete**. Any domain can differ from the defaults, and can have its own price, which the person sees instead of Cloudflare's, for example what you charge a customer. Saving makes a one-time invite link, valid for 7 days, to send however you like; the person signs in or creates an account, and the domains appear in their list marked with who shares them. Changes to a share apply at once, and **Remove** ends it.

Your connection makes the Cloudflare requests for a shared domain, and its token never reaches the other person. The server checks every request on a shared domain against the levels, and anything not explicitly allowed is refused: account-wide pages (Turnstile, DNS Views, DNS Firewall, transfer peers, Registrar, usage and billing) stay yours, and commands in the Console only work on a shared domain where they belong to an area the person has access to. The mapping of routes and commands to areas is in [`server/utils/access.js`](server/utils/access.js).

## Security

- Passwords are scrypt hashes; sign-in, sign-up and password checks are rate-limited per address.
- Sessions are random values in an HttpOnly, SameSite=Lax cookie (Secure over HTTPS), stored only as hashes, lasting 30 days from the last visit. Changing the password signs out other sessions; deleting an account removes its connections and shares.
- Cloudflare tokens are encrypted with AES-256-GCM and only decrypted on the server for the request that needs one.
- Every `/api` request passes through [`server/middleware/auth.js`](server/middleware/auth.js), which refuses requests from other sites (by `Origin`), requires a session, picks the connection and enforces sharing. Request bodies over 25 MB are refused.
- In production, pages send `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a same-origin referrer policy and HSTS (which browsers only honour over HTTPS).
- Run the app behind HTTPS. Behind a proxy, it reads `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-For`, so make sure the proxy sets them and the app isn't reachable around it.

## How the app talks to Cloudflare

The server calls Cloudflare by cf command name, such as `dns records list` or `zones settings edit`, rather than by hand-written API paths. [`server/cf/catalogue.json`](server/cf/catalogue.json) lists every API command in the cf release it was built from, with each command's method, path, arguments and flags, and where each flag goes in the request: the query string, a header, or a field in the JSON body. [`server/utils/cfCommand.js`](server/utils/cfCommand.js) turns a command and its values into the same request cf would send, with the same checks: required arguments, choices, numbers and true/false values, and flags that can't be combined. The exceptions are DNS analytics and R2 metrics, which use Cloudflare's GraphQL API; cf has no command for them. R2 object keys keep their slashes in the path (`docs/report.pdf`), as Cloudflare's API spec requires, where cf itself encodes them as `%2F`.

cf itself isn't installed or run. Its CLI is built for a terminal and its SDK isn't published as a library, so the app uses the catalogue cf is generated from and sends the requests itself, which keeps Cloudflare's error codes and adds no large runtime dependency.

To move to a newer cf release, rebuild the catalogue from that release's source and check it:

```bash
npm run cf:sync            # latest cf on npm, or: npm run cf:sync -- 1.0.0-beta.5
npm run cf:check           # compare every command's request with cf's own --dry-run
```

`cf:sync` reads cf's generated command files at the release tag and reports any command whose request it couldn't map fully; those still run in the Console with the request body entered as JSON. `cf:check` downloads that cf release with npx, fills in every command's arguments and flags, and compares the method, URL, query string and body with `cf <command> --dry-run`. Nothing is sent to Cloudflare. It exits with an error if any command differs, apart from a short list of known differences in cf itself.

## Console

**Console** in the sidebar (`/console`) runs any cf API command with the saved token:

- Search finds commands by what they do and ranks them as `cf cli search` does; browsing walks the same groups `cf <group> --help` lists. Commands that only run on your own machine, such as `cf dev` or `cf deploy`, are listed and say so.
- Each command shows its help, its API method and path, and a field for every argument and flag, labelled with where it goes in the request. Account commands have an account picker and zone commands a zone picker; commands that act on either let you choose.
- **Command** shows the equivalent cf command line to copy into a terminal. **Dry run** shows the request without sending it, as `--dry-run` does. **Run** sends it and shows what cf would print (the `result`), Cloudflare's whole response, and the request that was sent, with **Next page** for paged lists.
- Commands cf asks to confirm, and every delete, ask here too.

A link such as `/console?command=dns+dnssec+get&zone=<zone id>` opens a command with a zone chosen.

## Tools

Three utilities sit outside any zone under **Tools** in the sidebar:

- **DNS Lookup** (`/tools/dns-lookup`) queries Cloudflare's and Google's public resolvers over DNS-over-HTTPS and shows the answers side by side, with TTLs, DNSSEC validation and a resolvers-agree check. Entering an IP address runs a reverse lookup. The records page's **More** menu opens the tool pre-filled with that zone.
- **Propagation Check** (`/tools/propagation`) asks the zone's own nameservers and 15 public resolvers (Cloudflare, Google, Quad9, OpenDNS and others across several countries) for a record over plain DNS, then reports which resolvers already return the expected value or match the nameservers, how long stale caches have left, and whether the nameservers agree with each other. Record rows have a **Check propagation** action that opens the tool pre-filled; proxied records compare against the nameservers because their public answer is Cloudflare's edge.
- **Domain Search** (`/tools/domain-search`) checks whether a name is registered across a chosen set of endings using each registry's RDAP service (bootstrapped from IANA), falls back to a public-resolver NS query where a registry publishes no RDAP, shows Porkbun's public first-year price as a reference figure, and optionally Cloudflare Registrar's live price and whether it can register each name for the chosen account. It links to Cloudflare Registrar, Porkbun and Namecheap to buy, and names Cloudflare can register link to the Registrar page. Names that already exist as zones on the token are flagged.

These tools contact third-party services from this server: the resolvers, the relevant registry's RDAP endpoint, IANA and Porkbun receive only the names being looked up, never the Cloudflare token. The propagation check needs outbound UDP/TCP port 53 from wherever the app is hosted, and it won't query name server addresses in private, loopback or link-local ranges. Cloudflare Registrar is the one purchase made in the app: `/registrar` shows Cloudflare's quote, asks you to confirm the exact total and checks the price again immediately before submitting. It charges the account's default payment method and can't be refunded. The Console won't run `registrar registrations create` for the same reason, apart from a dry run. Purchases from other registrars complete on their own sites.

## Validation

```bash
npm run lint
npm run build
npm run test:e2e   # after build: accounts, connections and sharing against a stand-in Cloudflare
npm run cf:check   # after changing the catalogue or server/utils/cfCommand.js
```

`test:e2e` starts the built server on port 3997 with a temporary data directory and a stand-in Cloudflare API on port 3998 (`CLOUDFLARE_API_BASE`), signs up three accounts and checks what each can and can't do.

The production build uses Nitro's Node server preset and retains the `server/api/*` routes that proxy Cloudflare requests.

## Production

Build and run locally:

```bash
npm run build
npm run start
```

Or build the included container, keeping the data directory on a volume:

```bash
docker build -t dns-manager .
docker run --rm -p 3000:3000 -v dns-manager-data:/app/.data -e NUXT_TOKEN_KEY -e OPENAI_API_KEY dns-manager
```

| Variable                             | Purpose                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `NUXT_DATA_DIR`                      | Where the SQLite database lives (`.data` by default). Keep it on a volume. |
| `NUXT_TOKEN_KEY`                     | 32 random bytes, base64, to encrypt stored tokens. Strongly recommended.   |
| `OPENAI_API_KEY`, `OPENAI_DNS_MODEL` | The records page's AI editor, off without a key.                           |
| `CLOUDFLARE_API_BASE`                | For the end-to-end tests only; leave unset.                                |

The server keeps its data in `NUXT_DATA_DIR` (`.data` by default): the SQLite database of accounts, sessions and encrypted connections. Set `NUXT_TOKEN_KEY` to 32 random bytes, base64-encoded (`openssl rand -base64 32`), to encrypt the stored tokens with a key kept outside that directory. Without it, the server makes a key once and saves it as `token.key` in the data directory, so a copy of the directory would be enough to read the tokens. Changing or losing the key makes the stored tokens unreadable, and each connection has to be added again.

To back up, copy the data directory while the app is stopped, or use `sqlite3 dns-manager.sqlite ".backup backup.sqlite"` while it runs (the database uses write-ahead logging, so copying the file alone mid-write can miss changes). Keep `NUXT_TOKEN_KEY` with the backup, separately. The container has a health check on `/api/health`, which also confirms the database answers.

Theme tokens live in [`app/assets/css/main.css`](app/assets/css/main.css), while Nuxt UI component defaults live in [`app/app.config.js`](app/app.config.js).

## Privacy and indexing

This is an authenticated operational tool, not a public website. The app emits both `robots` metadata and an `X-Robots-Tag` header to prevent indexing.
