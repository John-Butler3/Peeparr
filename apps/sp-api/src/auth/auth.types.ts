import type { Request } from 'express';

export interface AuthenticatedAdmin {
  id: string;
  username: string;
  normalizedUsername: string;
  sessionVersion: number;
}

export interface RequestAuthContext {
  bootstrapRequired: boolean;
  authenticated: boolean;
  user: AuthenticatedAdmin | null;
  sessionId: string | null;
}

export interface AuthStatusResponse {
  bootstrapRequired: boolean;
  authenticated: boolean;
  username: string | null;
  /** Set on login when the temporary reset password was used. */
  passwordChangeRequired?: boolean;
}

export type AuthenticatedRequest = Request & {
  authContext?: RequestAuthContext;
};
