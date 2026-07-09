export default defineNuxtConfig({
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
		},
		pageTransition: { name: 'fade', mode: 'out-in' }
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
			collections: ['clarity', 'heroicons', 'lucide']
		}
	},

	runtimeConfig: {
		openaiApiKey: process.env.OPENAI_API_KEY || '',
		openaiDnsModel: process.env.OPENAI_DNS_MODEL || 'gpt-5.4-nano'
	},

	css: ['~/assets/css/main.css'],

	routeRules: {
		'/**': {
			headers: {
				'X-Robots-Tag': 'noindex, nofollow, noarchive'
			}
		}
	},

	compatibilityDate: '2026-01-01'
})
