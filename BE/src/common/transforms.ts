import type { TransformFnParams } from 'class-transformer';

// Dùng với @Transform: email về chữ thường + bỏ khoảng trắng 2 đầu (so khớp/unique ổn định).
export const toNormalizedEmail = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.toLowerCase().trim() : value;

// Dùng với @Transform: bỏ khoảng trắng 2 đầu trước khi validate độ dài (vd fullName "  A  ").
export const toTrimmed = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;
