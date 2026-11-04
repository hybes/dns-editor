import { useRuntimeConfig } from '#imports'
import * as Sentry from '@sentry/nuxt'
import { sanitizeSentrySpan, sentryOptions } from './shared/utils/sentry'

const config = useRuntimeConfig().public

Sentry.init({
	...sentryOptions({
		dsn: config.sentryDsn,
		environment: config.sentryEnvironment,
		runtime: 'browser',
		disabled: String(config.sentryDisabled) === 'true'
	}),
	beforeSendSpan: Sentry.withStaticSpan(sanitizeSentrySpan)
})
