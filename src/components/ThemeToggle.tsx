'use client';

import { useThemeContext } from './ThemeProvider';
import { WeatherSunny24Filled, WeatherMoon24Filled } from '@fluentui/react-icons';
import { tokens } from '@fluentui/react-components';

const ThemeToggle = () => {
  const { toggleTheme, isDark } = useThemeContext();

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        width: '52px',
        height: '26px',
        borderRadius: '20px',
        border: `1px solid ${isDark ? '#ffffff' : '#242424'}`,
        position: 'relative',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 6px',
        boxSizing: 'border-box',
        backgroundColor: isDark ? '#242424' : '#f2f2f2',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '3px',
          left: isDark ? '6px' : '26px',
          borderRadius: '50%',
          height: '18px',
          width: '18px',
          backgroundColor: isDark ? '#E6E6E6' : '#242424',
          transition: 'left 0.3s ease',
        }}
      />
      <WeatherSunny24Filled
        style={{
          height: '14px',
          width: '14px',
          color: isDark ? '#a1a1aa' : '#f59e0b',
          zIndex: 1,
        }}
      />
      <WeatherMoon24Filled
        style={{
          height: '14px',
          width: '14px',
          color: isDark ? '#4ade80' : '#a1a1aa',
          zIndex: 1,
        }}
      />
    </button>
  );
};

export default ThemeToggle;
