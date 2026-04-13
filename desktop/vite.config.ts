import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    clearScreen: false,
    server: {
        port: 5173,
        strictPort: true,
    },
    envPrefix: ["VITE_", "TAURI_ENV_*"],
    build: {
        target: "chrome105",
        minify: !process.env.TAURI_ENV_DEBUG ? "oxc" : false,
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
})
