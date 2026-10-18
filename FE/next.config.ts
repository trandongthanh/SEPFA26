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
      "img-src 'self' data: blob: https://res.cloudinary.com https:",
      "font-src 'self' https://fonts.gstatic.com data:",
      // Cho phép FE gọi API sang BE + GetStream Video SDK domains (API + Video SFU WebSockets)
      "connect-src 'self' http: https: ws: wss: data: blob: https://*.stream-io-api.com https://*.stream-io-cdn.com https://getstream.io https://*.stream-io-video.com wss://*.stream-io-video.com https://*.stream-io.com wss://*.stream-io.com",
      // Ngăn trang bị nhúng vào frame của domain khác
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Fix: monorepo có nhiều lockfile → chỉ rõ root để Next.js không nhầm
  outputFileTracingRoot: path.join(__dirname, '../../'),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
    ],
  },
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
