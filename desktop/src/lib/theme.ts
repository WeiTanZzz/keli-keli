export type Theme = "light" | "dark" | "system"

const STORAGE_KEY = "keli-keli-theme"

export function getTheme(): Theme {
    return (localStorage.getItem(STORAGE_KEY) as Theme) ?? "system"
}

export function saveTheme(theme: Theme): void {
    localStorage.setItem(STORAGE_KEY, theme)
}

export function applyTheme(theme: Theme): void {
    const isDark =
        theme === "dark" ||
        (theme === "system" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches)
    document.documentElement.classList.toggle("dark", isDark)
}
