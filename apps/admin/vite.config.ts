import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/auth/health': { target: 'http://127.0.0.1:4001', changeOrigin: true, rewrite: () => '/health' },
      '/api/auth': { target: 'http://127.0.0.1:4001', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/auth/, '/api/v1/auth') },
      '/api/admin': { target: 'http://127.0.0.1:4001', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/admin/, '/api/v1/admin') },
      '/api/channels/health': { target: 'http://127.0.0.1:4002', changeOrigin: true, rewrite: () => '/health' },
      '/api/channels': { target: 'http://127.0.0.1:4002', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/channels/, '/api/v1/channels') },
      '/api/v1/admin/content-sources': { target: 'http://127.0.0.1:4003', changeOrigin: true },
      '/api/v1/admin/content-worker': { target: 'http://127.0.0.1:4003', changeOrigin: true },
      '/api/v1/admin/content-ingest': { target: 'http://127.0.0.1:4003', changeOrigin: true },
      '/api/v1/videos': { target: 'http://127.0.0.1:4003', changeOrigin: true },
    },
  },
});
