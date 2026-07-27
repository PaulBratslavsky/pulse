import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getUserMeService } from '@/data/services/auth'

/**
 * Everything requires a session except /sign-in. Beyond cookie presence, the
 * token is validated against /api/users/me (Epic Next pattern) so expired or
 * revoked JWTs bounce at the edge instead of failing inside pages.
 * /api/pulse/* (the authenticated proxy) is skipped — it 401s naturally.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const token = request.cookies.get('pulse_jwt')?.value
  const user = token ? await getUserMeService(token) : null
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
