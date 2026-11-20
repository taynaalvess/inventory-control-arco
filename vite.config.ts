import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base relativo: funciona em qualquer nome de repositório no GitHub Pages
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          scanner: ['@zxing/browser', '@zxing/library'],
          xlsx: ['xlsx'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
