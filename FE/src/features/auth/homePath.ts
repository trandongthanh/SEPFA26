// Trang đầu tiên sau khi đăng nhập, theo vai trò — dùng chung cho đăng nhập email, Google, trang gốc.
// Web chỉ dành cho admin và nhà vườn; khách hàng dùng app điện thoại.
export function homePathForRole(role?: string | null): string {
  if (role === 'ADMIN') return '/admin/verify/providers';
  if (role === 'PROVIDER') return '/provider/dashboard';
  return '/auth/login';
}
