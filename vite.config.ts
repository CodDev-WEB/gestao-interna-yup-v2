import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Site em web/, gerado em dist/ (servido pelo Worker como assets).
// Em desenvolvimento, /api vai para o Worker publicado.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], graficos: ['recharts'] } } },
  },
  server: { proxy: { '/api': { target: 'https://gestao-interna-yup-v2.jordano-19-silva.workers.dev', changeOrigin: true } } },
})
