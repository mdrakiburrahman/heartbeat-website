'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { FluentProvider, Theme } from '@fluentui/react-components';
import { themeType, lightTheme, darkTheme } from '@/styles/theme';

interface ThemeContextType {
  theme: { value: Theme; key: string };
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: { value: darkTheme, key: themeType.dark },
  toggleTheme: () => {},
  isDark: true,
});

const defaultTheme = {
  value: darkTheme,
  key: themeType.dark,
};

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<{ value: Theme; key: string }>(defaultTheme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Get the user's preferred theme from local storage, default to dark theme if not set
    let localTheme = localStorage.getItem('heartbeat-theme');
    if (!localTheme) {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      localTheme = prefersDark ? themeType.dark : themeType.light;
      localStorage.setItem('heartbeat-theme', localTheme);
    }
    // Determine the selected theme based on the user's preference
    const fluentTheme = localTheme === themeType.light ? lightTheme : darkTheme;

    // Set the data-theme attribute on the document body for CSS styling
    document.body.setAttribute('data-theme', localTheme);

    // Set the initial theme
    setTheme({ value: fluentTheme, key: localTheme });
  }, []);

  // Function to toggle the theme
  const toggleTheme = () => {
    // Get the user's current theme from local storage
    const localTheme = localStorage.getItem('heartbeat-theme');

    // Determine the new theme based on the user's current theme
    const fluentTheme = localTheme === themeType.light ? darkTheme : lightTheme;

    // Determine the new user theme based on the user's current theme
    const newLocalTheme = localTheme === themeType.light ? themeType.dark : themeType.light;

    // Update the user's theme in local storage
    localStorage.setItem('heartbeat-theme', newLocalTheme);

    // Update the data-theme attribute on the document body for CSS styling
    document.body.setAttribute('data-theme', newLocalTheme);

    // Set the new theme
    setTheme({ value: fluentTheme, key: newLocalTheme });
  };

  const isDark = theme.key === themeType.dark;

  // Prevent flash of wrong theme
  if (!mounted) {
    return (
      <FluentProvider theme={darkTheme}>
        <div style={{ visibility: 'hidden' }}>{children}</div>
      </FluentProvider>
    );
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
        isDark,
      }}
    >
      <FluentProvider theme={theme.value}>{children}</FluentProvider>
    </ThemeContext.Provider>
  );
};

export const useThemeContext = () => useContext(ThemeContext);

export default ThemeProvider;
