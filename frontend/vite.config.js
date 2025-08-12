import react from "@vitejs/plugin-react";
import { defineConfig } from 'vite';

// Ensure VITE_API_URL is set in the environment file (.env)
//const apiUrl = "https://localhost:442"
export default defineConfig({
  plugins: [react()],
  
  server: {
    port: 5173, // React app running on port 5173 (default for Vite)
    /*proxy: {
      '/': {
        target: apiUrl, 
        changeOrigin: true,  // Necessary for virtual hosted sites
        secure: false,  // Set to true if your backend uses HTTPS
       
      },
    },*/
  },
});
