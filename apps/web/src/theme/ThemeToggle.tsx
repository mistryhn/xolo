import { useTheme } from './context'

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme()
  const label = `Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {resolvedTheme === 'dark' ? '☀' : '☾'}
    </button>
  )
}
