import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'

interface ThemeState {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      resolvedTheme: getSystemTheme(),
      setTheme: (theme) => {
        const resolved = theme === 'system' ? getSystemTheme() : theme
        document.documentElement.classList.toggle('dark', resolved === 'dark')
        set({ theme, resolvedTheme: resolved })
      }
    }),
    { name: 'theme-storage' }
  )
)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { setTheme, resolvedTheme } = useThemeStore()
  
  useEffect(() => {
    const listener = () => {
      if (useThemeStore.getState().theme === 'system') {
        useThemeStore.setState({ resolvedTheme: getSystemTheme() })
      }
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', listener)
    return () => window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', listener)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
  }, [resolvedTheme])

  return typeof children === 'function' ? children(useThemeStore.getState()) : children
}