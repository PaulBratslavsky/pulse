import { z } from 'zod'

export const SigninFormSchema = z.object({
  identifier: z.string().min(2, { message: 'Enter your email or username' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters' }),
})

export type FormState = {
  success?: boolean
  zodErrors?: Record<string, string[]> | null
  strapiError?: string | null
  data?: { identifier?: string }
}
