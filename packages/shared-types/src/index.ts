// melodyflix shared types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface HealthStatus {
  service: string;
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  timestamp: string;
}

export interface JwtPayload {
  sub: string;
  role: string;
}
