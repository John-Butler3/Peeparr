export interface AuthStatusResponse {
  bootstrapRequired: boolean;
  authenticated: boolean;
  username: string | null;
  /** Set on login when the temporary reset password was used. */
  passwordChangeRequired?: boolean;
}

export interface BootstrapAdminPayload {
  username: string;
  password: string;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}
