import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: Number(process.env.PORT ?? 5173),
    proxy: {
      "/api": {
        target: process.env.VITE_SERVER_ORIGIN ?? "http://localhost:5172",
        changeOrigin: true,
        secure: false
      }
    }
  }
});
