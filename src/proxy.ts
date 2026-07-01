import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const AUTH_ROUTES = new Set([
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
])

export const PROTECTED_PAGE_PREFIXES = [
  '/dashboard',
  '/inbox',
  '/contacts',
  '/pipelines',
  '/broadcasts',
  '/automations',
  '/flows',
  '/n8n-workflows',
  '/properties',
  '/appointments',
  '/settings',
]

const PUBLIC_API_PREFIXES = [
  '/api/whatsapp/webhook',
  '/api/automations/cron',
  '/api/flows/cron',
  '/api/n8n/dispatch/cron',
]

const AUTH_REQUIRED_API_PREFIXES = [
  '/api/whatsapp/',
  '/api/n8n/',
  '/api/flows',
  '/api/automations',
]

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            void options
          })
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  if (user && AUTH_ROUTES.has(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  if (!user && PROTECTED_PAGE_PREFIXES.some((path) => pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  const isPublicApi = PUBLIC_API_PREFIXES.some((path) => pathname.startsWith(path))
  const requiresAuthApi = AUTH_REQUIRED_API_PREFIXES.some((path) =>
    pathname.startsWith(path),
  )
  if (!user && requiresAuthApi && !isPublicApi) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
