"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME_KEY, safeSetItem } from "@/lib/state/storage";

/** The icon follows the theme through CSS, so there is no state to get out of step with the page. */
export function ThemeToggle() {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Switch between light and dark mode"
      onClick={() => {
        const dark = document.documentElement.classList.toggle("dark");
        safeSetItem(THEME_KEY, dark ? "dark" : "light");
      }}
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}
