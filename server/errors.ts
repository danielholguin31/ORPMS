import type { ApiErrorBody } from '../shared/types';
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Partial<ApiErrorBody> = {},
  ) {
    super(message);
  }
  toJSON(): ApiErrorBody {
    return { code: this.code, message: this.message, ...this.details };
  }
}
export function invariant(
  condition: unknown,
  message: string,
  code = 'INVARIANT',
  status = 409,
): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
