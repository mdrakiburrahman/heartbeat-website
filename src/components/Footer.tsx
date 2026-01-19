'use client';

import { useThemeContext } from './ThemeProvider';

const Footer = () => {
  const { isDark } = useThemeContext();
  const currentYear = new Date().getFullYear();

  const linkStyle = {
    color: isDark ? '#a1a1aa' : '#616161',
    textDecoration: 'none',
    fontSize: '11px',
    transition: 'color 0.2s',
  };

  return (
    <footer
      style={{
        backgroundColor: isDark ? '#0a0a0a' : '#f2f2f2',
        borderTop: `1px solid ${isDark ? '#2a2a2a' : '#e0e0e0'}`,
        padding: '12px 24px',
      }}
    >
      <div
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {/* Left - Microsoft copyright */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="14" height="14" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="10" height="10" fill="#F25022" />
            <rect x="11" width="10" height="10" fill="#7FBA00" />
            <rect y="11" width="10" height="10" fill="#00A4EF" />
            <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
          </svg>
          <span style={{ fontSize: '11px', color: isDark ? '#ffffff' : '#424242', fontWeight: 500 }}>
            © {currentYear} Microsoft
          </span>
        </div>

        {/* Center - Disclaimer */}
        <div
          style={{
            fontSize: '11px',
            color: isDark ? 'rgba(255,255,255,0.6)' : '#616161',
          }}
        >
          This is an unofficial tool for viewing Real-Time Intelligence Streams. Built with the{' '}
          <a
            href="https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/eventhub/event-hubs"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: isDark ? '#89e8ad' : '#16a34a', textDecoration: 'none' }}
          >
            @azure/event-hubs
          </a>{' '}
          SDK.
        </div>

        {/* Right - Links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <a
            href="https://privacy.microsoft.com/privacystatement"
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
          >
            Privacy
          </a>
          <a
            href="https://www.microsoft.com/legal/terms-of-use"
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
          >
            Terms of Use
          </a>
          <a
            href="https://azure.microsoft.com/support/legal/"
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
          >
            Legal
          </a>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
