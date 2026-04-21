import { createContext, useContext, useState } from "react"

export type Lang = "en" | "zh"

const STORAGE_KEY = "kelikeli_lang"

function detectLang(): Lang {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "en" || stored === "zh") return stored
    return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"
}

const MONTHS_EN = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
]

export type Translations = {
    nav: {
        statistics: string
        general: string
        indicator: string
        connections: string
        about: string
    }
    btn: {
        save: string
        saved: string
        cancel: string
        saveAndReopen: string
        export: string
    }
    dialog: {
        restartRequired: string
        restartDesc: string
    }
    stats: {
        today: string
        summary: string
        explore: string
        byApp: string
        total: string
        keystrokes: string
        clicks: string
        dailyAvg: string
        bestDay: string
        streak: string
        allTime: string
        actionsToday: string
        keys: string
        noClicks: string
        actions: string
        inARow: string
        noStreak: string
        noActivity: string
        noData: string
        noDataYet: string
        vsYesterday: string
    }
    general: {
        title: string
        language: string
        languageDesc: string
        launchAtStartup: string
        launchDesc: string
        flushInterval: string
        flushDesc: string
    }
    indicator: {
        title: string
        badges: string
        icon: string
        iconDesc: string
        emoji: string
        activeApp: string
        emojiLabel: string
        emojiDesc: string
        keystroke: string
        leftClick: string
        rightClick: string
    }
    connections: {
        httpSync: string
        websocket: string
        export: string
        apiUrl: string
        apiKey: string
        syncInterval: string
        wsUrl: string
        idleTimeout: string
        exportData: string
        exportDesc: string
    }
    about: {
        title: string
        version: string
        autoUpdate: string
        autoUpdateDesc: string
        checking: string
        upToDate: string
        installing: string
        updateTo: string
        errorServer: string
    }
    chart: {
        keys: string
        clicks: string
        keysLabel: string
        clicksLabel: string
        left: string
        right: string
        fmtDate: (month: number, day: number) => string
        fmtMonth: (month: number) => string
    }
    lang: { en: string; zh: string }
}

const translations: Record<Lang, Translations> = {
    en: {
        nav: {
            statistics: "Statistics",
            general: "General",
            indicator: "Indicator",
            connections: "Connections",
            about: "About",
        },
        btn: {
            save: "Save",
            saved: "Saved ✓",
            cancel: "Cancel",
            saveAndReopen: "Save & Reopen",
            export: "Export",
        },
        dialog: {
            restartRequired: "Restart required",
            restartDesc:
                "Connection settings take effect after a restart. Save and reopen now?",
        },
        stats: {
            today: "Today",
            summary: "Summary",
            explore: "Explore",
            byApp: "By App",
            total: "Total",
            keystrokes: "Keystrokes",
            clicks: "Clicks",
            dailyAvg: "Daily avg",
            bestDay: "Best day",
            streak: "Streak",
            allTime: "All time",
            actionsToday: "actions today",
            keys: "keys",
            noClicks: "no clicks",
            actions: "actions",
            inARow: "in a row",
            noStreak: "no streak",
            noActivity: "No activity yet — start typing!",
            noData: "No data for this period.",
            noDataYet: "No data yet — start typing!",
            vsYesterday: "vs yesterday",
        },
        general: {
            title: "General",
            language: "Language",
            languageDesc: "Display language",
            launchAtStartup: "Launch at startup",
            launchDesc: "Start KeliKeli when you log in",
            flushInterval: "Flush interval",
            flushDesc: "How often to save data (seconds)",
        },
        indicator: {
            title: "Indicator",
            badges: "Badges",
            icon: "Icon",
            iconDesc: "What to show in the floating window",
            emoji: "Emoji",
            activeApp: "Active App",
            emojiLabel: "Emoji",
            emojiDesc: "Type any emoji or pick a preset",
            keystroke: "Keystroke",
            leftClick: "Left click",
            rightClick: "Right click",
        },
        connections: {
            httpSync: "HTTP Sync",
            websocket: "WebSocket",
            export: "Export",
            apiUrl: "API URL",
            apiKey: "API Key",
            syncInterval: "Sync interval (s)",
            wsUrl: "WS URL",
            idleTimeout: "Idle timeout (ms)",
            exportData: "Export data",
            exportDesc: "Download all your stats as JSON",
        },
        about: {
            title: "About",
            version: "Version",
            autoUpdate: "Auto-update",
            autoUpdateDesc: "Automatically install updates at launch",
            checking: "Checking…",
            upToDate: "Up to date",
            installing: "Installing, restarting shortly…",
            updateTo: "Update to",
            errorServer: "Could not reach update server",
        },
        chart: {
            keys: "keys",
            clicks: "clicks",
            keysLabel: "Keys",
            clicksLabel: "Clicks",
            left: "L",
            right: "R",
            fmtDate: (m, d) => `${MONTHS_EN[m]} ${d}`,
            fmtMonth: (m) => MONTHS_EN[m],
        },
        lang: { en: "English", zh: "中文" },
    },
    zh: {
        nav: {
            statistics: "统计",
            general: "通用",
            indicator: "指示器",
            connections: "连接",
            about: "关于",
        },
        btn: {
            save: "保存",
            saved: "已保存 ✓",
            cancel: "取消",
            saveAndReopen: "保存并重启",
            export: "导出",
        },
        dialog: {
            restartRequired: "需要重启",
            restartDesc: "连接设置将在重启后生效，立即保存并重启？",
        },
        stats: {
            today: "今天",
            summary: "概览",
            explore: "探索",
            byApp: "应用详情",
            total: "总计",
            keystrokes: "按键",
            clicks: "点击",
            dailyAvg: "日均",
            bestDay: "最佳",
            streak: "连续",
            allTime: "累计",
            actionsToday: "今日操作",
            keys: "按键",
            noClicks: "无点击",
            actions: "次操作",
            inARow: "天连续",
            noStreak: "暂无",
            noActivity: "暂无数据，开始使用吧！",
            noData: "该时段暂无数据。",
            noDataYet: "暂无数据，开始使用吧！",
            vsYesterday: "较昨日",
        },
        general: {
            title: "通用",
            language: "语言",
            languageDesc: "界面显示语言",
            launchAtStartup: "开机启动",
            launchDesc: "登录时自动启动 KeliKeli",
            flushInterval: "刷新间隔",
            flushDesc: "数据保存频率（秒）",
        },
        indicator: {
            title: "指示器",
            badges: "气泡",
            icon: "图标",
            iconDesc: "浮动窗口显示内容",
            emoji: "表情",
            activeApp: "当前应用",
            emojiLabel: "表情符号",
            emojiDesc: "输入任意表情或选择预设",
            keystroke: "按键",
            leftClick: "左键",
            rightClick: "右键",
        },
        connections: {
            httpSync: "HTTP 同步",
            websocket: "WebSocket",
            export: "导出",
            apiUrl: "API 地址",
            apiKey: "API 密钥",
            syncInterval: "同步间隔（秒）",
            wsUrl: "WS 地址",
            idleTimeout: "空闲超时（毫秒）",
            exportData: "导出数据",
            exportDesc: "将统计数据下载为 JSON",
        },
        about: {
            title: "关于",
            version: "版本",
            autoUpdate: "自动更新",
            autoUpdateDesc: "启动时自动安装更新",
            checking: "检查中…",
            upToDate: "已是最新",
            installing: "安装中，即将重启…",
            updateTo: "更新至",
            errorServer: "无法连接更新服务器",
        },
        chart: {
            keys: "按键",
            clicks: "点击",
            keysLabel: "按键",
            clicksLabel: "点击",
            left: "左键",
            right: "右键",
            fmtDate: (m, d) => `${m + 1}月${d}日`,
            fmtMonth: (m) => `${m + 1}月`,
        },
        lang: { en: "English", zh: "中文" },
    },
}

type LangContextValue = {
    lang: Lang
    setLang: (l: Lang) => void
    t: Translations
}

const LangContext = createContext<LangContextValue | null>(null)

export function LangProvider({ children }: { children: React.ReactNode }) {
    const [lang, setLangState] = useState<Lang>(detectLang)

    const setLang = (l: Lang) => {
        localStorage.setItem(STORAGE_KEY, l)
        setLangState(l)
    }

    return (
        <LangContext.Provider value={{ lang, setLang, t: translations[lang] }}>
            {children}
        </LangContext.Provider>
    )
}

export function useT() {
    const ctx = useContext(LangContext)
    if (!ctx) throw new Error("useT must be used within LangProvider")
    return ctx
}
