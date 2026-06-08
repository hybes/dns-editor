import withNuxt from './.nuxt/eslint.config.mjs'
import prettierRecommended from 'eslint-plugin-prettier/recommended'
import unusedImports from 'eslint-plugin-unused-imports'

export default withNuxt(
	{
		ignores: ['lib/**', 'app/components/ui/**', '.nuxt/**', '.output/**', 'dist/**']
	},
	prettierRecommended,
	{
		plugins: {
			'unused-imports': unusedImports
		},
		rules: {
			'no-undef': 'off',
			'no-unused-vars': 'off',
			'unused-imports/no-unused-imports': 'error',
			'unused-imports/no-unused-vars': [
				'warn',
				{
					vars: 'all',
					varsIgnorePattern: '^_',
					args: 'after-used',
					argsIgnorePattern: '^_'
				}
			],
			'vue/no-use-v-if-with-v-for': 'off',
			'vue/no-v-html': 'off',
			'vue/multi-word-component-names': 'off'
		}
	}
)
