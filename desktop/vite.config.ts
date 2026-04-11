import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
    plugins: [react()],
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
