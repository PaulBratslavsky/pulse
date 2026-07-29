import { redirect } from 'next/navigation'
import { strapiFetch } from '@/lib/strapi'
import ChatUI from '@/components/chat-ui'

export default async function ChatPage() {
  let config: any
  try {
    config = await strapiFetch('/api/insights/config')
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    config = { data: { aiEnabled: false } }
  }

  if (!config.data.aiEnabled) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-1">Chat with the data</h1>
        {/* placeholder spans the content column like the Insights one; only the
            copy inside stays measure-limited so it doesn't run edge to edge */}
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
          <p className="text-lg font-medium mb-2">AI features are disabled</p>
          <p className="text-sm text-zinc-500 max-w-lg mx-auto">
            Pulse runs fully without AI — mentions flow in, the team responds and tracks outcomes,
            and sentiment can be labeled manually. To enable chat, AI drafts, and automatic
            sentiment analysis, set <code className="text-xs">AI_API_KEY</code> on the backend.
            Previously skipped mentions are analyzed automatically once a key is added.
          </p>
        </div>
      </div>
    )
  }

  return <ChatUI />
}
