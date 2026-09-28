import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PROXY = {
  '/api/auth': { target: 'http://127.0.0.1:4001', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/api\/auth/, '/api/v1/auth') },
  '/api/channels': { target: 'http://127.0.0.1:4002', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/api\/channels/, '/api/v1/channels') },
  '/api/v1/videos': { target: 'http://127.0.0.1:4003', changeOrigin: true },
  '/api/notifications': { target: 'http://127.0.0.1:4004', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/api\/notifications/, '/api/v1/notifications') },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: PROXY,
  },
  preview: {
    host: '0.0.0.0',
    port: 5174,
    proxy: PROXY,
  },
});
