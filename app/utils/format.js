// Formatting shared across pages. An undefined locale follows the browser, so dates and
// numbers read the way the person using the app expects. Pass `timeZone: 'UTC'` style
// options to Intl directly where a page deliberately shows UTC.
export const LOCALE = undefined

const DATE_STYLES = {
	medium: { dateStyle: 'medium' },
	datetime: { dateStyle: 'medium', timeStyle: 'short' },
	full: { dateStyle: 'full', timeStyle: 'short' }
}
const dateFormats = new Map()

const toDate = (value) => {
	if (value === undefined || value === null || value === '') return null
	const date = value instanceof Date ? value : new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

// Styles: 'medium' (15 Sept 2026), 'datetime' (15 Sept 2026, 10:23), 'full'. Returns ''
// for missing or invalid input.
export const formatDate = (value, style = 'medium') => {
	const date = toDate(value)
	if (!date) return ''
	const key = DATE_STYLES[style] ? style : 'medium'
	if (!dateFormats.has(key)) dateFormats.set(key, new Intl.DateTimeFormat(LOCALE, DATE_STYLES[key]))
	return dateFormats.get(key).format(date)
}

const timeFormat = new Intl.DateTimeFormat(LOCALE, { timeStyle: 'medium' })

export const formatTime = (value) => {
	const date = toDate(value)
	return date ? timeFormat.format(date) : ''
}

const numberFormat = new Intl.NumberFormat(LOCALE)

export const formatNumber = (value) => numberFormat.format(Number(value) || 0)

export const plural = (count, word, pluralWord = `${word}s`) =>
	`${formatNumber(count)} ${count === 1 ? word : pluralWord}`
