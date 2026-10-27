import { useEffect, useState } from "react";

// light | dark | system (README do handoff 1b: "theme" persistido e aplicado
// via data-theme no <html>). "system" segue o sistema operacional ao vivo.
export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "dgs.theme";

function readChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // armazenamento bloqueado: segue o sistema
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const theme: "light" | "dark" = choice === "system" ? (systemDark ? "dark" : "light") : choice;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // sem armazenamento: só não lembra a escolha
    }
  }, [theme, choice]);

  return {
    theme,
    choice,
    setChoice,
    toggleTheme: () => setChoice(theme === "dark" ? "light" : "dark"),
  };
}
