// Shared API response envelope used across services and hooks
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}