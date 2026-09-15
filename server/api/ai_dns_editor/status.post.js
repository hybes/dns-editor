// Tells the records page whether the AI editor can run, so the button isn't offered on a
// server without an OpenAI key. Only availability is reported; the key never leaves the server.
export default defineEventHandler((event) => {
	const config = useRuntimeConfig(event)
	const available = Boolean(config.openaiApiKey)

	return {
		success: true,
		result: {
			available,
			reason: available ? '' : 'The AI editor needs OPENAI_API_KEY set on the server.'
		}
	}
})
