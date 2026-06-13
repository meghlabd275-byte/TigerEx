"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = "" }: ThemeToggleProps) {
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

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    localStorage.setItem("tigerex-theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  if (!mounted) {
    return (
      <button className={`p-2 rounded-lg ${className}`}>
        <div className="w-5 h-5 bg-gray-400 rounded animate-pulse" />
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className={`p-2 rounded-lg transition-all duration-200 ${
        theme === "dark" 
          ? "bg-white/10 hover:bg-white/20 text-yellow-400" 
          : "bg-gray-100 hover:bg-gray-200 text-gray-700"
      } ${className}`}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </button>
  );
}

// Export theme colors as CSS variables
export function getThemeCSSVariables(theme: "light" | "dark") {
  const colors = theme === "dark" 
    ? {
        "--bg-primary": "#0A0A0F",
        "--bg-secondary": "#14141A",
        "--text-primary": "#FFFFFF",
        "--text-secondary": "#9CA3AF",
        "--border-color": "rgba(255,255,255,0.1)",
        "--accent": "#FF6B35",
        "--accent-hover": "#FF8555",
        "--success": "#10B981",
        "--error": "#EF4444",
        "--warning": "#F59E0B",
        "--card-bg": "rgba(255,255,255,0.05)",
        "--card-hover": "rgba(255,255,255,0.1)",
      }
    : {
        "--bg-primary": "#FFFFFF",
        "--bg-secondary": "#F8FAFC",
        "--text-primary": "#0F172A",
        "--text-secondary": "#64748B",
        "--border-color": "#E2E8F0",
        "--accent": "#FF6B35",
        "--accent-hover": "#E55A2B",
        "--success": "#10B981",
        "--error": "#EF4444",
        "--warning": "#F59E0B",
        "--card-bg": "#FFFFFF",
        "--card-hover": "#F1F5F9",
      };
  
  return Object.entries(colors)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}