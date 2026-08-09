import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
    ...nextCoreWebVitals,
    ...nextTypeScript,
    globalIgnores([
        '.next/**',
        'playwright-report/**',
        'test-results/**',
        'next-env.d.ts',
        'tsconfig.tsbuildinfo',
    ]),
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'react-hooks/immutability': 'off',
            'react-hooks/purity': 'off',
            'react-hooks/set-state-in-effect': 'off',
            'react/no-unescaped-entities': 'off',
        },
    },
]);
