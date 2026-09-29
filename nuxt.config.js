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

	modules: ['@nuxt/ui', '@nuxt/eslint'],

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
		openaiDnsModel: process.env.OPENAI_DNS_MODEL || 'gpt-5.4-nano'
	},

	css: ['~/assets/css/main.css'],

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
