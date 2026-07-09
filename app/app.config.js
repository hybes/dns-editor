export default defineAppConfig({
	site: {
		name: 'DNS Manager',
		description: 'A focused control centre for Cloudflare DNS records.'
	},
	ui: {
		colors: {
			primary: 'orange',
			neutral: 'comet'
		},
		button: {
			slots: {
				base: 'rounded-lg font-medium'
			},
			defaultVariants: {
				size: 'md'
			}
		},
		input: {
			slots: {
				base: 'rounded-lg'
			}
		},
		textarea: {
			slots: {
				base: 'rounded-lg'
			}
		},
		select: {
			slots: {
				base: 'rounded-lg'
			}
		},
		selectMenu: {
			slots: {
				base: 'rounded-lg'
			}
		},
		card: {
			slots: {
				root: 'rounded-xl'
			}
		},
		modal: {
			slots: {
				content: 'rounded-xl overscroll-contain'
			}
		},
		dropdownMenu: {
			slots: {
				content: 'rounded-lg'
			},
			defaultVariants: {
				size: 'sm'
			}
		}
	}
})
