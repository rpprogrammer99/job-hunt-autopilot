/**
 * Bridge between the React AuthContext and the plain `fetch`-based API modules.
 *
 * The AuthProvider registers a token getter at startup; API helpers call
 * `authHeaders()` to attach `Authorization: Bearer <id-token>` when a real
 * user is signed in. In demo mode no token is attached (the backend uses its
 * reserved demo identity locally).
 */
type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter = async () => null;

export function registerTokenGetter(getter: TokenGetter): void {
  tokenGetter = getter;
}

export async function authHeaders(
  base: Record<string, string> = {},
): Promise<Record<string, string>> {
  const token = await tokenGetter();
  if (token) return { ...base, Authorization: `Bearer ${token}` };
  return base;
}
