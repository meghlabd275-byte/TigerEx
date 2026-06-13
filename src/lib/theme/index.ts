"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme, ThemeProvider } from "./ThemeProvider";

export { ThemeProvider, useTheme };

// Hook for auto-applying theme classes
export function useThemeClass() {
  const { theme } = useThemeWithDefault();
  return theme;
}

export function useThemeWithDefault() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("tigerex-theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
    setMounted(true);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("tigerex-theme", next);
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

  const setTheme = useCallback((newTheme: "light" | "dark") => {
    localStorage.setItem("tigerex-theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    setTheme(newTheme);
  }, []);

  return { theme: mounted ? theme : "dark", toggleTheme, setTheme, mounted };
}

// Theme-specific colors
export const themeColors = {
  light: {
    bg: "#FFFFFF",
    bgSecondary: "#F8FAFC",
    text: "#0F172A",
    textSecondary: "#64748B",
    border: "#E2E8F0",
    accent: "#FF6B35",
    accentHover: "#E55A2B",
    success: "#10B981",
    error: "#EF4444",
    warning: "#F59E0B",
    card: "#FFFFFF",
    cardHover: "#F1F5F9",
  },
  dark: {
    bg: "#0A0A0F",
    bgSecondary: "#14141A",
    text: "#FFFFFF",
    textSecondary: "#9CA3AF",
    border: "rgba(255,255,255,0.1)",
    accent: "#FF6B35",
    accentHover: "#FF8555",
    success: "#10B981",
    error: "#EF4444",
    warning: "#F59E0B",
    card: "rgba(255,255,255,0.05)",
    cardHover: "rgba(255,255,255,0.1)",
  },
} as const;

export type ThemeColorKey = keyof typeof themeColors.light;

// Get CSS variable for theme
export function getThemeColor(key: ThemeColorKey, theme: "light" | "dark"): string {
  return themeColors[theme][key];
}

// Apply theme to document
export function applyTheme(theme: "light" | "dark") {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("tigerex-theme", theme);
  }
}