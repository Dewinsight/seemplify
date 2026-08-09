export type PendingAssistantMessage = {
  type?: string
  content?: string
  timestamp?: Date
  isLoading?: boolean
}

export function settleAssistantWebSocketError<T extends PendingAssistantMessage>(
  messages: T[],
  errorMessage: string,
  timestamp = new Date()
): T[] {
  const loadingIndex = messages.findLastIndex(
    (message) => message.type === 'assistant' && message.isLoading === true
  )
  if (loadingIndex === -1) return messages

  const nextMessages = [...messages]
  nextMessages[loadingIndex] = {
    ...nextMessages[loadingIndex],
    content: errorMessage,
    timestamp,
    isLoading: false
  }
  return nextMessages
}
