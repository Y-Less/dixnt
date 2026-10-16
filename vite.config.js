import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// In development the Vite dev server (5173) proxies the game socket and card images to the Node server (3000).
export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/cards': 'http://localhost:3000',
    },
  },
});
