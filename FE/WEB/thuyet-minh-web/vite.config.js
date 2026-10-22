import { defineConfig } from 'vite';

const backendTarget = process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/health': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
});
