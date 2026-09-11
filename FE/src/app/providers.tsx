'use client';

import type { ReactNode } from 'react';
import { ConfigProvider, App as AntdApp } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { Colors } from '@/lib/colors';

const theme = {
  token: {
    colorPrimary: Colors.primary,
    colorPrimaryHover: '#4e1ba8',
    colorLink: Colors.primary,
    colorText: Colors.textPrimary,
    colorTextSecondary: Colors.textSecondary,
    colorTextPlaceholder: Colors.placeholder,
    colorBgBase: Colors.cardBg,
    borderRadius: 12,
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    fontSize: 14,
  },
  components: {
    Button: {
      borderRadius: 50,
      controlHeight: 42,
      colorPrimary: Colors.primary,
      colorPrimaryHover: '#4e1ba8',
      primaryShadow: '0 4px 14px rgba(96, 39, 210, 0.25)',
    },
    Input: {
      borderRadius: 12,
      colorBgContainer: Colors.inputBg,
      colorBorder: Colors.inputBorder,
      colorTextPlaceholder: Colors.placeholder,
      colorText: Colors.textPrimary,
      activeBorderColor: Colors.primary,
      hoverBorderColor: Colors.primary,
    },
    Checkbox: {
      colorPrimary: Colors.primary,
    },
  },
};

export default function AntdProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider locale={viVN} theme={theme}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
