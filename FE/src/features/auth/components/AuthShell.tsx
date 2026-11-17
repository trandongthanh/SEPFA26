'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';

// Khung chung cho các trang xác thực phụ (quên / đặt lại mật khẩu):
// cột trái ảnh hoa lan giống trang đăng nhập, cột phải là nội dung.
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 md:p-8 bg-[#F6F4FC]">
      <div className="w-full max-w-[940px] bg-white rounded-[26px] shadow-[0_20px_60px_rgba(96,39,210,0.1)] overflow-hidden grid grid-cols-1 md:grid-cols-2 border border-[#ECE7FA]">
        <div className="relative hidden md:flex min-h-[500px] flex-col justify-between p-7 text-white overflow-hidden select-none">
          <Image
            src="/Login-image.webp"
            alt="LanCare Hub"
            fill
            priority
            className="object-cover object-[53%_center]"
            sizes="50vw"
          />
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-[#1d0738]/95 via-[#2a0e52]/40 via-35% to-transparent" />
          <div className="relative z-10 flex items-center gap-3">
            <img src="/logo_app.png" alt="LanCare Hub logo" className="w-14 h-14 object-contain shrink-0" />
            <h2 className="font-logo-script text-[26px] font-bold leading-tight tracking-wide flex items-center">
              <span className="text-white">LanCare</span>
              <span className="text-[#C4B5FD] ml-1.5">Hub</span>
            </h2>
          </div>
          <div className="relative z-10">
            <h3 className="text-[18px] font-bold text-white tracking-wide">Bảo vệ tài khoản của bạn</h3>
            <p className="text-[12px] text-white/90 leading-relaxed max-w-[340px] mt-1">
              Link đặt lại mật khẩu chỉ dùng được một lần và hết hạn sau 30 phút.
            </p>
          </div>
        </div>

        <div className="p-6 sm:p-8 md:py-10 md:px-9 flex flex-col justify-center bg-white min-h-[420px]">
          {children}
        </div>
      </div>
    </main>
  );
}
