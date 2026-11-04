import { useRuntimeConfig } from '#imports'
import * as Sentry from '@sentry/nuxt'
import { browserSentrySettings, sanitizeSentrySpan, sentryOptions } from './shared/utils/sentry'

// Off unless the page is served from a real (non-local) address, or NUXT_PUBLIC_SENTRY_FORCE=1.
const settings = browserSentrySettings(useRuntimeConfig().public)

Sentry.init({
	...sentryOptions({
		...settings,
		runtime: 'browser',
		consoleLogs: Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] })
	}),
	beforeSendSpan: Sentry.withStaticSpan(sanitizeSentrySpan)
})
