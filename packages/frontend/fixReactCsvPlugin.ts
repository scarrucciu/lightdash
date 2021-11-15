import * as path from 'path';
import type { Plugin as ESBuildPlugin } from 'esbuild';
import type { Plugin } from 'vite';

export function fixReactCsvPlugin(): Plugin {
    const esbuildPlugin: ESBuildPlugin = {
        name: 'esbuild:resolve-fixes',
        setup: (build) => {
            build.onResolve({ filter: /react-csv$/ }, () => {
                return Promise.resolve({
                    path: path.join(
                        process.cwd(),
                        '../../node_modules/react-csv/index.js',
                    ),
                });
            });
        },
    };

    return {
        name: 'resolve-fixes',
        config() {
            return {
                optimizeDeps: {
                    // development fixes
                    esbuildOptions: { plugins: [esbuildPlugin] },
                },
                resolve: {
                    // production fixes
                    alias: [
                        {
                            find: 'react-csv',
                            replacement:
                                '../../node_modules/react-csv/index.js',
                        },
                    ],
                },
            };
        },
    };
}
