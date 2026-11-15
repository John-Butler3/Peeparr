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
  /** Signed out: the account has a passkey, so Face ID can be offered at once. */
  passkeys?: boolean;
  /** Signed in: the session ends when the app is closed. */
  lockOnClose?: boolean;
  /** Signed in: the app was left and the session will end unless it resumes. */
  lockPending?: boolean;
}

export type AuthenticatedRequest = Request & {
  authContext?: RequestAuthContext;
};
