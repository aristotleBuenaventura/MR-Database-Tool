import { useTheme } from "../theme/ThemeContext";

type Props = {
  /** Compact control for sidebars / headers */
  compact?: boolean;
  className?: string;
};

export function ThemeToggle({ compact = false, className = "" }: Props) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={`theme-toggle ${compact ? "is-compact" : ""} ${className}`.trim()}
      role="group"
      aria-label="Color theme"
    >
      {!compact ? <span className="theme-toggle-label">Theme</span> : null}
      <div className="theme-toggle-track">
        <button
          type="button"
          className={theme === "light" ? "is-active" : undefined}
          aria-pressed={theme === "light"}
          onClick={() => setTheme("light")}
        >
          Light
        </button>
        <button
          type="button"
          className={theme === "dark" ? "is-active" : undefined}
          aria-pressed={theme === "dark"}
          onClick={() => setTheme("dark")}
        >
          Dark
        </button>
      </div>
    </div>
  );
}
