const STRAPI_URL = process.env.NEXT_PUBLIC_STRAPI_URL ?? 'http://localhost:1337'

type AuthSuccess = { jwt: string; user: { id: number; username: string; email: string } }
type AuthError = { error: { status: number; name: string; message: string } }

export function isAuthError(res: AuthSuccess | AuthError): res is AuthError {
  return 'error' in res
}

export async function loginUserService(identifier: string, password: string) {
  const res = await fetch(`${STRAPI_URL}/api/auth/local`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
    cache: 'no-store',
  })
  return (await res.json()) as AuthSuccess | AuthError
}

export async function getUserMeService(authToken: string) {
  try {
    const res = await fetch(`${STRAPI_URL}/api/users/me`, {
      headers: { authorization: `Bearer ${authToken}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
