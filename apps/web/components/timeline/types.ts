import type { Kind } from './kind-meta'

export type SystemEntryData = { type: 'system'; at: string; action: string; actor: string | null; detail: any }
export type DiscussionEntryData = {
  type: 'discussion'
  at: string
  kind: Kind
  body: string
  links: string[]
  author: string | null
  authorDocumentId: string | null
  edited: boolean
  id: string
}
export type Entry = SystemEntryData | DiscussionEntryData
