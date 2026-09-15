import type { Metadata, Viewport } from 'next';
import './globals.css';
import { checkBoot } from '@/lib/boot-check';
import { BootErrorScreen } from '@/components/boot-error';

export const metadata: Metadata = {
  title: 'HOKK Product Operations',
  description: 'House of Kala Katha — master product catalog, content, photography and Shopify export platform.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Pre-flight: a misconfigured deployment (no database / secrets) renders a
  // friendly fix-it screen instead of Next's "Application error" digest page.
  const boot = checkBoot();
  return (
    <html lang="en">
      <body className="min-h-screen">{boot.ok ? children : <BootErrorScreen failure={boot} />}</body>
    </html>
  );
}
