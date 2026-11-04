import * as Sentry from '@sentry/nuxt'
import { getSentryDsn, isSentryTestRuntime, sanitizeSentrySpan, sentryOptions } from './shared/utils/sentry'

Sentry.init({
	...sentryOptions({
		dsn: getSentryDsn(),
		environment: process.env.NODE_ENV || 'development',
		runtime: 'server',
		disabled: isSentryTestRuntime() || process.env.SENTRY_DISABLED === 'true'
	}),
	beforeSendSpan: Sentry.withStaticSpan(sanitizeSentrySpan)
})
