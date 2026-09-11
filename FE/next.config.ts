import type { NextConfig } from 'next';
import path from 'path';

// Security headers áp dụng cho mọi route
const securityHeaders = [
  // Ngăn trình duyệt đoán MIME type của file (chống MIME sniffing attack)
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Ngăn nhúng trang vào iframe (chống clickjacking)
  { key: 'X-Frame-Options', value: 'DENY' },
  // Không gửi referrer ra domain ngoài
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Ngăn trình duyệt cũ thực thi XSS được phát hiện
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  // Content-Security-Policy: hạn chế nội dung được tải/thực thi
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // unsafe-inline và unsafe-eval bắt buộc cho Next.js + Ant Design (inline styles)
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "font-src 'self' https://fonts.gstatic.com data:",
      // Cho phép FE gọi API sang BE (thêm URL production khi deploy)
      "connect-src 'self' http://localhost:3001 http://localhost:3002",
      // Ngăn trang bị nhúng vào frame của domain khác
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Fix: monorepo có nhiều lockfile → chỉ rõ root để Next.js không nhầm
  outputFileTracingRoot: path.join(__dirname, '../../'),
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
