/** `GET /api/me`: the signed-in account. */
export interface Me {
  id: string;
  name: string;
  email: string;
  role: "customer" | "admin";
  emailVerified: boolean;
  /** A one-click demo account (its sandbox goes after a day). */
  demo: boolean;
}
