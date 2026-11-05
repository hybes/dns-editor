import { DEFAULT_CAP_SITE_KEY } from './shared/utils/cap'
import { getSentryDsn, isOn, isSentryTestRuntime } from './shared/utils/sentry'

const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN?.trim())

export default defineNuxtConfig({
	// Everything the app shows depends on a token held in the browser, so pages render
	// client-side only. The Nitro server still serves the /api proxies.
	ssr: false,
	spaLoadingTemplate: 'spa-loading-template.html',

	app: {
		head: {
			htmlAttrs: {
				lang: 'en-GB'
			},
			meta: [
				{ name: 'robots', content: 'noindex, nofollow, noarchive' },
				{ name: 'color-scheme', content: 'dark light' }
			],
			link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
			script:
				process.env.NODE_ENV === 'production'
					? [
							{
								id: 'umami-script',
								src: 'https://view.cnnct.uk/script.js',
								async: true,
								'data-website-id': '7911a836-2f1b-431a-903d-1d898a030724'
							}
						]
					: []
		}
	},

	modules: ['@nuxt/ui', '@nuxt/eslint', '@sentry/nuxt/module'],

	sourcemap: uploadSourceMaps ? { client: 'hidden', server: 'hidden' } : false,

	sentry: {
		org: 'connect-dorset',
		project: 'dns-editor',
		sentryUrl: process.env.SENTRY_URL || 'https://error.cnnct.uk/',
		authToken: process.env.SENTRY_AUTH_TOKEN,
		telemetry: false,
		silent: !uploadSourceMaps,
		release: { create: false, finalize: false, setCommits: false },
		sourcemaps: {
			disable: !uploadSourceMaps,
			filesToDeleteAfterUpload: ['.nuxt/dist/**/*.map', '.output/**/*.map']
		},
		errorHandler: () => {
			console.warn('[GlitchTip] Source-map upload failed; continuing without source maps.')
		}
	},

	ui: {
		fonts: false,
		theme: {
			transitions: true
		}
	},

	icon: {
		serverBundle: {
			collections: ['lucide']
		}
	},

	runtimeConfig: {
		// Where the SQLite database (and, without NUXT_TOKEN_KEY, the token encryption key) lives.
		dataDir: process.env.NUXT_DATA_DIR || '.data',
		// 32 random bytes, base64, to encrypt stored Cloudflare tokens. See server/utils/secrets.js.
		tokenKey: process.env.NUXT_TOKEN_KEY || '',
		openaiApiKey: process.env.OPENAI_API_KEY || '',
		openaiDnsModel: process.env.OPENAI_DNS_MODEL || 'gpt-5.4-nano',
		// Cap's secret for the site key, set at run time as NUXT_CAP_SECRET_KEY and never built in.
		// See shared/utils/cap.js and server/utils/cap.js.
		capSecretKey: '',
		// NUXT_PUBLIC_SENTRY_* override these when the server starts. Whether the browser reports
		// depends on the page's address: see browserSentrySettings in shared/utils/sentry.js.
		public: {
			sentryDsn: getSentryDsn(process.env, 'browser'),
			// Empty means production on a real address and development on a local one.
			sentryEnvironment: process.env.NUXT_PUBLIC_SENTRY_ENVIRONMENT || '',
			sentryForce: isOn(process.env.NUXT_PUBLIC_SENTRY_FORCE || process.env.VITE_SENTRY_FORCE),
			sentryDisabled: isSentryTestRuntime() || process.env.NUXT_PUBLIC_SENTRY_DISABLED === 'true',
			// Cap on sign-in and sign-up. NUXT_PUBLIC_CAP_SITE_KEY overrides the site key (empty turns
			// Cap off); NUXT_PUBLIC_CAP_API_ENDPOINT replaces https://cap.brth.uk/<site key>/.
			capSiteKey: DEFAULT_CAP_SITE_KEY,
			capApiEndpoint: ''
		}
	},

	css: ['~/assets/css/main.css'],

	// Cap's widget (components/CapCheck.vue) is a web component, not a Vue one.
	vue: {
		compilerOptions: {
			isCustomElement: (tag) => tag === 'cap-widget'
		}
	},

	nitro: {
		// Node's built-in SQLite (server/utils/db.js) loads at run time, not from the bundle.
		rollupConfig: { external: ['node:sqlite'] }
	},

	routeRules: {
		'/**': {
			headers: {
				'X-Robots-Tag': 'noindex, nofollow, noarchive',
				// In production only: the dev preview may show the app in a frame.
				...(process.env.NODE_ENV === 'production' && {
					'X-Content-Type-Options': 'nosniff',
					'Referrer-Policy': 'same-origin',
					'X-Frame-Options': 'DENY',
					'Content-Security-Policy': "frame-ancestors 'none'",
					'Cross-Origin-Opener-Policy': 'same-origin',
					'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
					// Browsers ignore this over plain HTTP, so it only applies behind HTTPS.
					'Strict-Transport-Security': 'max-age=31536000'
				})
			}
		}
	},

	compatibilityDate: '2026-01-01'
})
