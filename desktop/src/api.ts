import { invoke } from "@tauri-apps/api/core"

export interface Config {
    flush_interval_secs: number
    auto_update: boolean
    sync: {
        enabled: boolean
        api_url: string
        api_key: string
        interval_secs: number
    }
    websocket: { enabled: boolean; ws_url: string; typing_idle_ms: number }
}

export interface DayStat {
    date: string
    count: number
}

export interface AppStat {
    date: string
    app: string
    count: number
}

export interface AppClickStat {
    date: string
    app: string
    left_clicks: number
    right_clicks: number
}

export interface AllTimeCounts {
    keystrokes: number
    left_clicks: number
    right_clicks: number
}

export interface UpdateInfo {
    current: string
    latest: string | null
    available: boolean
}

export const api = {
    getConfig: (): Promise<Config> => invoke<Config>("get_config"),

    saveConfig: (newCfg: Config): Promise<void> =>
        invoke("save_config", { newCfg }),

    getAutostart: (): Promise<boolean> => invoke<boolean>("get_autostart"),

    setAutostart: (enabled: boolean): Promise<void> =>
        invoke("set_autostart", { enabled }),

    getAllTimeCounts: (): Promise<AllTimeCounts> =>
        invoke<AllTimeCounts>("get_all_time_counts"),

    getStats: (days: number): Promise<DayStat[]> =>
        invoke<DayStat[]>("get_stats", { days }),

    getAppStats: (days: number): Promise<AppStat[]> =>
        invoke<AppStat[]>("get_app_stats", { days }),

    getAppClickStats: (days: number): Promise<AppClickStat[]> =>
        invoke<AppClickStat[]>("get_app_click_stats", { days }),

    checkUpdate: (): Promise<UpdateInfo> => invoke<UpdateInfo>("check_update"),

    installUpdate: (): Promise<void> => invoke("install_update"),

    getAppIcon: (appName: string): Promise<string | null> =>
        invoke<string | null>("get_app_icon", { appName }),

    getAppDisplayName: (appName: string): Promise<string | null> =>
        invoke<string | null>("get_app_display_name", { appName }),
}
