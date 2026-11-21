import type { ReactNode } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cuộc gọi Video · LanCare Hub',
  description: 'Gọi video trực tiếp giữa nhà vườn và khách hàng trên LanCare Hub',
};

/**
 * Layout cho trang video call — full screen, không header/sidebar.
 * Tối ưu: không render AntdProvider hay các layout khác không cần thiết.
 */
export default function CallsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0f0e1a]">
      {children}
    </div>
  );
}
