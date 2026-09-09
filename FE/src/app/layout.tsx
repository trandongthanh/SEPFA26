import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import AntdProvider from './providers';

export const metadata: Metadata = {
  title: 'LanCare Hub',
  description: 'Kết nối người yêu lan · Chăm lan dễ dàng hơn',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <AntdProvider>{children}</AntdProvider>
      </body>
    </html>
  );
}
