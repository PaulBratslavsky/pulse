'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { loginUserAction } from '@/data/actions/auth'
import type { FormState } from '@/data/validation/auth'

const INITIAL_STATE: FormState = { zodErrors: null, strapiError: null, data: {} }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending}
      className="w-full rounded-md bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  )
}

export default function SignInPage() {
  const [state, formAction] = useActionState(loginUserAction, INITIAL_STATE)

  return (
    // px-4: signed-out pages render outside the app shell, so nothing else
    // provides gutters — at max-w-sm the card otherwise touches both edges of
    // a 390px phone
    <div className="mx-auto mt-20 max-w-sm px-4">
      <h1 className="text-2xl font-semibold mb-1">Sign in to Strapi Pulse</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Accounts are created by the admin — ask if you don&apos;t have one.
      </p>
      <form action={formAction} className="space-y-4">
        <div>
          <input
            name="identifier"
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
            placeholder="Email or username"
            defaultValue={state.data?.identifier ?? ''}
            required
          />
          {state.zodErrors?.identifier?.map((e) => (
            <p key={e} className="text-sm text-red-600 mt-1">{e}</p>
          ))}
        </div>
        <div>
          <input
            name="password"
            type="password"
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
            placeholder="Password"
            required
          />
          {state.zodErrors?.password?.map((e) => (
            <p key={e} className="text-sm text-red-600 mt-1">{e}</p>
          ))}
        </div>
        {state.strapiError && <p className="text-sm text-red-600">{state.strapiError}</p>}
        <SubmitButton />
      </form>
    </div>
  )
}
