import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import type { IncomingMessage, ServerResponse } from 'http';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

const addHeaders = (res: ServerResponse) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET');
	res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
};

const viteServerConfig = (): Plugin => ({
	name: 'add-headers',
	configureServer: (server: ViteDevServer) => {
		server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
			addHeaders(res);
			next();
		});
	},
	configurePreviewServer: (server: PreviewServer) => {
		server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
			addHeaders(res);
			next();
		});
	}
});

export default defineConfig({
	plugins: [react(), viteServerConfig()],
	optimizeDeps: {
		exclude: ['@openmeteo/file-reader', '@openmeteo/file-format-wasm']
	},
	build: { chunkSizeWarningLimit: 1500 }
});
