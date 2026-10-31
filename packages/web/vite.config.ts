import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In compose the API runs in the `server` container; API_URL points there.
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    proxy: {
      '/api': apiUrl,
    },
  },
});
