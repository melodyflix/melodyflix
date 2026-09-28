// melodyflix auth - user model
export interface User {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  avatar_url: string | null;
  email_verified: number;
  role: string;
  created_at: string;
  updated_at: string;
}

export type SafeUser = Omit<User, 'password_hash'>;

export function toSafeUser(user: User): SafeUser {
  const { password_hash: _ph, ...safe } = user;
  return safe;
}
