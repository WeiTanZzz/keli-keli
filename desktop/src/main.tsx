import { getCurrentWindow } from "@tauri-apps/api/window"
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import Settings from "./Settings"
import "./index.css"

const label = getCurrentWindow().label
if (label === "main") document.body.classList.add("indicator")

const root = document.getElementById("root")
if (root) {
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            {label === "settings" ? <Settings /> : <App />}
        </React.StrictMode>,
    )
}
