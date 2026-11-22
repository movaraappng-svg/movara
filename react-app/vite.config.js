import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages hosts this repository beneath /movara/.
  base: process.env.GITHUB_ACTIONS === 'true' ? '/movara/' : '/',
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('maplibre-gl')) return 'maps';
          if (id.includes('leaflet') || id.includes('react-leaflet')) return 'maps';
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('framer-motion') || id.includes('/motion-dom/') || id.includes('/motion-utils/')) return 'motion';
          if (id.includes('@hugeicons')) return 'icons';
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'react-vendor';
        },
      },
    },
  },
});
