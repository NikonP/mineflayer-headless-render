// ESLint flat config: JavaScript Standard Style via neostandard, with
// formatting rules disabled so Prettier is the single source of formatting
// truth. Third-party code and generated output are not linted.
const neostandard = require('neostandard')
const prettier = require('eslint-config-prettier/flat')

module.exports = [
  ...neostandard({
    ignores: [
      'vendor/**',
      'bedrock-samples/**',
      'node_modules/**',
      '**/out/**',
      '**/*.d.ts'
    ]
  }),
  prettier
]
