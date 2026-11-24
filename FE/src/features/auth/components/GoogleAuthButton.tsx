'use client';

import React, { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { App } from 'antd';
import { authApi, getApiErrorCode } from '@/lib/api';
import { useAuthStore } from '@/lib/auth.store';
import { homePathForRole } from '../homePath';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: 'standard' | 'icon';
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              logo_alignment?: 'left' | 'center';
              width?: number | string;
              locale?: string;
            }
          ) => void;
          prompt?: (notification?: unknown) => void;
        };
      };
    };
  }
}

interface GoogleAuthButtonProps {
  mode: 'login' | 'register';
  beforeSubmit?: () => boolean;
}

export const GoogleAuthButton: React.FC<GoogleAuthButtonProps> = ({ mode, beforeSubmit }) => {
  const router = useRouter();
  // Dùng modal từ App.useApp: Modal.confirm tĩnh không hiện trên React 19 + antd 5.
  const { message, modal } = App.useApp();
  const setAuth = useAuthStore((state) => state.setAuth);
  const buttonContainerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const clientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    '9217582187-qcqif9q8eaoj0ibq80isbrma8t82eec5.apps.googleusercontent.com';

  const handleCredentialResponse = async (response: { credential: string }) => {
    const idToken = response.credential;
    if (!idToken) {
      message.error('Không nhận được mã xác thực từ Google.');
      return;
    }

    if (beforeSubmit && !beforeSubmit()) {
      return;
    }

    try {
      setLoading(true);

      if (mode === 'register') {
        // Đăng ký trực tiếp với role PROVIDER
        const res = await authApi.loginGoogle({
          idToken,
          role: 'PROVIDER',
        });

        // Email Google đã có sẵn tài khoản khách hàng → BE trả về tài khoản đó, web không cho vào.
        if (res.account?.role === 'CUSTOMER') {
          message.error(
            'Email Google này đã có tài khoản Khách hàng. Vui lòng đăng nhập trên ứng dụng di động.'
          );
          return;
        }

        setAuth(res.account, {
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
        });

        message.success(
          res.isNewAccount
            ? 'Đăng ký tài khoản Đối tác thành công! Mật khẩu dự phòng đã được gửi qua email.'
            : 'Đăng nhập thành công!'
        );
        router.push(homePathForRole(res.account?.role));
        return;
      }

      // Mode: Login
      try {
        const res = await authApi.loginGoogle({ idToken });

        if (res.account?.role === 'CUSTOMER') {
          message.error(
            'Tài khoản Khách hàng (Customer) không có quyền truy cập cổng Provider. Vui lòng đăng nhập trên ứng dụng di động.'
          );
          return;
        }

        setAuth(res.account, {
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
        });

        message.success('Đăng nhập Google thành công!');
        router.push(homePathForRole(res.account?.role));
      } catch (loginErr: any) {
        const status = loginErr?.response?.status;
        const data = loginErr?.response?.data;

        // Nếu tài khoản chưa đăng ký (404 GOOGLE_ACCOUNT_NOT_REGISTERED)
        if (status === 404 && getApiErrorCode(loginErr) === 'GOOGLE_ACCOUNT_NOT_REGISTERED') {
          const userEmail = data?.email || 'email này';
          modal.confirm({
            title: 'Tài khoản chưa đăng ký',
            content: `Tài khoản Google (${userEmail}) chưa tồn tại trong hệ thống. Bạn có muốn đăng ký làm Đối tác (Provider) với tài khoản này không?`,
            okText: 'Đăng ký ngay',
            cancelText: 'Hủy',
            okButtonProps: { style: { backgroundColor: '#6027D2' } },
            onOk: async () => {
              try {
                setLoading(true);
                const regRes = await authApi.loginGoogle({
                  idToken,
                  role: 'PROVIDER',
                });

                setAuth(regRes.account, {
                  accessToken: regRes.accessToken,
                  refreshToken: regRes.refreshToken,
                });

                message.success(
                  'Đăng ký tài khoản Đối tác thành công! Mật khẩu dự phòng đã được gửi qua email.'
                );
                router.push(homePathForRole(regRes.account?.role));
              } catch (regErr: any) {
                // data.message đã được interceptor dịch sang tiếng Việt.
                message.error(
                  regErr?.response?.data?.message || 'Đăng ký tài khoản thất bại.'
                );
              } finally {
                setLoading(false);
              }
            },
          });
          return;
        }

        throw loginErr;
      }
    } catch (err: any) {
      // So mã gốc (rawCode) — data.message đã bị interceptor đổi thành câu tiếng Việt.
      const rawMsg = getApiErrorCode(err);
      if (rawMsg === 'INVALID_GOOGLE_TOKEN') {
        message.error('Mã xác thực Google không hợp lệ hoặc đã hết hạn.');
      } else if (rawMsg === 'GOOGLE_EMAIL_NOT_VERIFIED') {
        message.error('Email Google chưa được xác minh.');
      } else if (rawMsg === 'ACCOUNT_SUSPENDED') {
        message.error('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');
      } else if (rawMsg === 'GOOGLE_AUTH_NOT_CONFIGURED') {
        message.error('Hệ thống chưa cấu hình đăng nhập Google.');
      } else if (rawMsg === 'GOOGLE_AUTH_UNAVAILABLE') {
        message.error('Không kết nối được tới Google. Vui lòng thử lại sau.');
      } else if (err?.response?.status === 429) {
        message.error('Bạn thử quá nhiều lần. Vui lòng đợi ít phút rồi thử lại.');
      } else {
        message.error(err?.response?.data?.message || 'Đăng nhập Google thất bại, vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Google chỉ nhận callback một lần lúc initialize → gọi qua ref để luôn dùng bản mới nhất
  // (vd. trạng thái tick "đồng ý điều khoản" trong beforeSubmit).
  const handlerRef = useRef(handleCredentialResponse);
  handlerRef.current = handleCredentialResponse;

  // Script Google đã tải từ trang trước (chuyển trang login ↔ register) thì onLoad không chạy lại
  // → kiểm tra sẵn khi mount, và báo lỗi nếu sau 10 giây vẫn chưa tải được.
  useEffect(() => {
    if (window.google?.accounts?.id) {
      setScriptLoaded(true);
      return;
    }
    const timer = setTimeout(() => {
      if (!window.google?.accounts?.id) setLoadFailed(true);
    }, 10000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!scriptLoaded || !window.google || !buttonContainerRef.current) return;

    try {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (res) => handlerRef.current(res),
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      // Render official Google button
      buttonContainerRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(buttonContainerRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: mode === 'register' ? 'signup_with' : 'signin_with',
        shape: 'pill',
        logo_alignment: 'left',
        width: 320,
        locale: 'vi',
      });
    } catch (err) {
      console.error('Lỗi khởi tạo Google GIS:', err);
    }
  }, [scriptLoaded, mode, clientId]);

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={() => {
          setLoadFailed(false);
          setScriptLoaded(true);
        }}
        onError={() => setLoadFailed(true)}
      />
      <div className="w-full flex flex-col items-center justify-center min-h-[44px]">
        {loading && (
          <div className="text-xs text-[#6027D2] mb-1 font-medium animate-pulse">
            Đang xác thực tài khoản Google...
          </div>
        )}
        <div
          ref={buttonContainerRef}
          className={`flex justify-center w-full transition-opacity ${
            loading ? 'opacity-50 pointer-events-none' : 'opacity-100'
          }`}
        />
        {!scriptLoaded && !loadFailed && (
          <div className="h-10 w-full max-w-[320px] rounded-full border border-gray-200 bg-gray-50 flex items-center justify-center text-xs text-gray-400">
            Đang tải dịch vụ Google...
          </div>
        )}
        {!scriptLoaded && loadFailed && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-10 w-full max-w-[320px] rounded-full border border-gray-200 bg-white flex items-center justify-center text-xs text-[#6027D2] hover:bg-[#F8F6FE]"
          >
            Không tải được dịch vụ Google — bấm để thử lại
          </button>
        )}
      </div>
    </>
  );
};
