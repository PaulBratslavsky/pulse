import { redirect } from 'next/navigation'
import { strapiFetch } from '@/lib/strapi'
import ChatUI from '@/components/chat/chat-ui'

export default async function ChatPage() {
  let config: any
  try {
    config = await strapiFetch('/api/insights/config')
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) redirect('/sign-in')
    config = { data: { aiEnabled: false } }
  }

  // chatEnabled, not aiEnabled: classification runs on a key alone, the
  // assistant needs AI_CHAT_ENABLED=true as a separate deliberate switch
  if (!config.data.chatEnabled) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-1">Chat with the data</h1>
        {/* placeholder spans the content column like the Insights one; only the
            copy inside stays measure-limited so it doesn't run edge to edge */}
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-12 text-center">
          <p className="text-lg font-medium mb-2">Chat is disabled</p>
          <p className="text-sm text-zinc-500 max-w-lg mx-auto">
            The assistant is a tool-calling agent that can read and write your queue, so it is off
            by default even when classification is running. Set{' '}
            <code className="text-xs">AI_CHAT_ENABLED=true</code> on the backend to turn it on.
          </p>
        </div>
      </div>
    )
  }

  return <ChatUI />
}
