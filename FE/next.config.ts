import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // + Google Identity Services
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
      "script-src-elem 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
      // + style của nút Google
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
      "img-src 'self' data: blob: https://res.cloudinary.com https:",
      "font-src 'self' https://fonts.gstatic.com data:",
      // + accounts.google.com (token/endpoint của GSI)
      "connect-src 'self' http: https: ws: wss: data: blob: https://accounts.google.com https://*.stream-io-api.com https://*.stream-io-cdn.com https://getstream.io https://*.stream-io-video.com wss://*.stream-io-video.com https://*.stream-io.com wss://*.stream-io.com",
      // + iframe của Google (nút đăng nhập / One Tap / popup)
      "frame-src 'self' https://accounts.google.com",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;