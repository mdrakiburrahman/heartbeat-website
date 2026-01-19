import type { Metadata } from 'next';
import '../styles/globals.css';
import ThemeProvider from '@/components/ThemeProvider';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Heartbeat - Fabric Real Time Intelligence Stream Viewer',
  description: 'Real-time streaming data viewer for Fabric Real Time Intelligence.',
  keywords: ['Fabric', 'Event Hub', 'Real Time Intelligence', 'RTI', 'Microsoft', 'Viewer'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
