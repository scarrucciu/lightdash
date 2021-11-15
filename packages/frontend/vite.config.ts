import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fixReactCsvPlugin } from './fixReactCsvPlugin';

export default defineConfig({
    build: {
        outDir: 'build',
    },
    define: {
        'process.env': process.env,
    },
    plugins: [fixReactCsvPlugin(), react()],
});
