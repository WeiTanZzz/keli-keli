import { getCurrentWindow } from "@tauri-apps/api/window"
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import Dashboard from "./Dashboard"
import Settings from "./Settings"
import "./index.css"

if (!import.meta.env.DEV) {
    document.addEventListener("contextmenu", (e) => e.preventDefault())
}

const label = getCurrentWindow().label
if (label === "main") document.body.classList.add("indicator")
if (label === "dashboard") document.body.classList.add("dashboard")

const root = document.getElementById("root")
if (root) {
    let component: React.ReactNode
    if (label === "settings") {
        component = <Settings />
    } else if (label === "dashboard") {
        component = <Dashboard />
    } else {
        component = <App />
    }
    ReactDOM.createRoot(root).render(
        <React.StrictMode>{component}</React.StrictMode>,
    )
}
