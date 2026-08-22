import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// This project is deployed entirely through GitHub -> Azure Static Web Apps.
// Nobody needs to run "vite dev" on the office laptop; this config exists
// only so the Azure Static Web Apps build step (GitHub Actions) knows how
// to build the frontend. Output goes to "dist", which matches the
// "Output location" configured when the Static Web App is created.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
