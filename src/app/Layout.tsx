import { NavLink, Outlet } from "react-router-dom";
import { FileText, Library, BookMarked, Settings, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { toggleTheme, useTheme } from "./theme";

const nav = [
  { to: "/", label: "文档库", icon: Library, end: true },
  { to: "/glossary", label: "术语库", icon: BookMarked, end: false },
  { to: "/settings", label: "设置", icon: Settings, end: false },
];

export function Layout() {
  const theme = useTheme();
  return (
    <div className="min-h-dvh bg-bg text-text-1">
      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="sticky top-6 hidden h-[calc(100dvh-3rem)] w-56 shrink-0 flex-col sm:flex">
          <div className="mb-8 flex items-center gap-2 px-2">
            <span className="grid size-9 place-items-center rounded-control bg-accent text-white shadow-sm">
              <FileText className="size-5" />
            </span>
            <div className="leading-tight">
              <div className="font-semibold tracking-tight">PDFTranslate</div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-3">
                AI · 本地优先
              </div>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent-soft text-accent"
                      : "text-text-2 hover:bg-surface-2 hover:text-text-1",
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <button
            onClick={toggleTheme}
            className={cn(styles.buttonGhost, styles.press, "mt-auto")}
            aria-label="切换主题"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {theme === "dark" ? "浅色" : "深色"}
          </button>
        </aside>

        <main className="min-w-0 flex-1 pb-12">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
