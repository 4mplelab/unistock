export type OAuthProvider = "google" | "microsoft" | "github" | "x";

export interface CurrentUser {
  identifier: string;
  label: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  provider: string;
  // false: サーバー側でAUTH_ENABLED=falseになっており、ログイン・ログアウトの概念がない
  auth_enabled: boolean;
}

export interface AllowedUser {
  id: number;
  identifier: string;
  label: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface AllowedUserCreateInput {
  identifier: string;
  label?: string | null;
  is_admin?: boolean;
}

export interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface ApiKeyCreateResult {
  key: ApiKey;
  raw_key: string;
}
