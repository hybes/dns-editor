import tailwindcss from '@tailwindcss/vite'
export default defineNuxtConfig({
	app: {
		head: {
			htmlAttrs: {
				lang: 'en-GB'
			},
			link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
			script: [
				{
					id: 'umami-script',
					src: 'https://view.cnnct.uk/script.js',
					async: true,
					'data-website-id': '7911a836-2f1b-431a-903d-1d898a030724'
				}
			]
		},
		pageTransition: { name: 'fade', mode: 'out-in' }
	},

	vite: {
		plugins: [tailwindcss()]
	},

	site: {
		url: 'https://dns.brth.uk',
		name: 'DNS Manager',
		description: 'API Key editor for Cloudflare DNS records',
		defaultLocale: 'en-GB',
		indexable: false
	},

	modules: ['@nuxtjs/device', '@nuxt/image', '@nuxt/ui', '@nuxt/icon', '@nuxt/eslint', '@nuxt/fonts', '@nuxtjs/seo'],

	seo: {
		meta: {
			applicationName: 'DNS Manager',
			keywords:
				'cloudflare editor, cloudflare api, cloudflare api editor, dns api, cloudflare edit dns, cloudflare api dns edit',
			themeColor: '#0c0a09',
			colorScheme: 'dark light',
			twitterCard: 'summary_large_image',
			twitterSite: '@hybes',
			twitterCreator: '@hybes',
			ogImage: '/favicon.svg',
			twitterImage: '/favicon.svg'
		}
	},

	seoUtils: {
		redirectToCanonicalSiteUrl: true
	},

	robots: {
		groups: [{ userAgent: ['*'], disallow: ['/'] }],
		sitemap: [],
		blockNonSeoBots: false
	},

	sitemap: {
		enabled: false
	},

	schemaOrg: {
		enabled: false
	},

	ogImage: {
		enabled: false
	},

	linkChecker: {
		failOnError: false,
		skipInspections: ['external-if-timeout', 'missing-hash']
	},

	ui: {
		global: true,
		icons: ['clarity']
	},

	runtimeConfig: {
		openaiApiKey: process.env.OPENAI_API_KEY || '',
		openaiDnsModel: process.env.OPENAI_DNS_MODEL || 'gpt-5-nano'
	},

	css: ['~/assets/css/main.css'],

	compatibilityDate: '2026-01-01'
})
