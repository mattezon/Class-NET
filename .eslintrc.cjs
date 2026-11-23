module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true
    }
  },
  settings: {
    react: {
      version: 'detect'
    }
  },
  plugins: ['react', 'react-hooks', 'react-refresh'],
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
  },
  ignorePatterns: ['dist', 'node_modules'],
  overrides: [
    {
      files: ['src/components/ChatPanel.jsx'],
      rules: {
        'no-use-before-define': ['error', { functions: false, classes: true, variables: true }]
      }
    },
    {
      files: ['*.cjs'],
      parserOptions: {
        sourceType: 'script'
      },
      rules: {
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
      }
    }
  ]
}
