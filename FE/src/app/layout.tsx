import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';
import AntdProvider from './providers';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'LanCare Hub',
  description: 'Kết nối người yêu lan · Chăm lan dễ dàng hơn',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={inter.variable} suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <AntdProvider>{children}</AntdProvider>
      </body>
    </html>
  );
}
