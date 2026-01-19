import type { Metadata } from 'next';
import '../styles/globals.css';
import ThemeProvider from '@/components/ThemeProvider';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Heartbeat - Fabric Spark Processing',
  description: 'Real-time streaming data viewer for Fabric Real Time Intelligence.',
  keywords: ['Fabric', 'Event Hub', 'Real Time Intelligence', 'RTI', 'Microsoft', 'Viewer'],
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    title: 'Heartbeat - Fabric Spark Processing',
    description: 'Real-time streaming data viewer for Fabric Real Time Intelligence.',
    url: 'https://heartbeatspark.z9.web.core.windows.net',
    siteName: 'Heartbeat',
    images: [
      {
        url: 'https://heartbeatspark.z9.web.core.windows.net/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Heartbeat - Fabric Spark Processing',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Heartbeat - Fabric Spark Processing',
    description: 'Real-time streaming data viewer for Fabric Real Time Intelligence.',
    images: ['https://heartbeatspark.z9.web.core.windows.net/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const ogImageUrl = 'https://heartbeatspark.z9.web.core.windows.net/og-image.png';

  return (
    <html lang="en">
      <head>
        <meta property="og:image" content={ogImageUrl} />
        <meta name="twitter:image" content={ogImageUrl} />
      </head>
      <body>
        <ThemeProvider>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <Header />
            <main style={{ flex: 1, paddingTop: '56px' }}>
              {children}
            </main>
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
