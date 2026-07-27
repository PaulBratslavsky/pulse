'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SigninFormSchema, type FormState } from '@/data/validation/auth'
import { loginUserService, isAuthError } from '@/data/services/auth'

const cookieConfig = {
  maxAge: 60 * 60 * 24 * 7, // 1 week
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
}

export async function loginUserAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const fields = {
    identifier: String(formData.get('identifier') ?? ''),
    password: String(formData.get('password') ?? ''),
  }

  const validated = SigninFormSchema.safeParse(fields)
  if (!validated.success) {
    return {
      zodErrors: validated.error.flatten().fieldErrors,
      strapiError: null,
      data: { identifier: fields.identifier },
    }
  }

  const res = await loginUserService(validated.data.identifier, validated.data.password)
  if (isAuthError(res)) {
    return {
      zodErrors: null,
      strapiError: res.error.message ?? 'Sign-in failed',
      data: { identifier: fields.identifier },
    }
  }

  const cookieStore = await cookies()
  cookieStore.set('pulse_jwt', res.jwt, cookieConfig)
  redirect('/')
}

export async function logoutUserAction() {
  const cookieStore = await cookies()
  cookieStore.set('pulse_jwt', '', { ...cookieConfig, maxAge: 0 })
  redirect('/sign-in')
}
