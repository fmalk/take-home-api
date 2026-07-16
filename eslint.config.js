import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
    {
        ignores: ['dist', 'node_modules', '.git'],
    },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: './tsconfig.json',
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...tsPlugin.configs.recommended.rules,
            '@typescript-eslint/explicit-function-return-type': 'warn',
            '@typescript-eslint/explicit-module-boundary-types': 'warn',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
        },
    },
];
