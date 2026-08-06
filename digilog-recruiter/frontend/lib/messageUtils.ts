// Utility functions for message formatting and processing

export interface MessageFormatOptions {
  maxLength?: number
  preserveFormatting?: boolean
  highlightCode?: boolean
}

/**
 * Format message content for display
 */
export function formatMessageContent(content: string, options: MessageFormatOptions = {}): string {
  const { maxLength = 1000, preserveFormatting = true } = options
  
  let formatted = content
  
  // Truncate if too long
  if (formatted.length > maxLength) {
    formatted = formatted.substring(0, maxLength) + '...'
  }
  
  // Preserve formatting if requested
  if (preserveFormatting) {
    // Convert markdown-style formatting to HTML-friendly format
    formatted = formatted
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
  }
  
  return formatted
}

/**
 * Extract code blocks from message content
 */
export function extractCodeBlocks(content: string): Array<{ language: string; code: string }> {
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
  const blocks: Array<{ language: string; code: string }> = []
  let match
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      code: match[2].trim()
    })
  }
  
  return blocks
}

/**
 * Check if message contains structured data (lists, tables, etc.)
 */
export function hasStructuredContent(content: string): boolean {
  const patterns = [
    /^\s*[-*+]\s+/m,     // Unordered lists
    /^\s*\d+\.\s+/m,     // Ordered lists
    /\|.*\|/m,           // Tables
    /```[\s\S]*?```/,    // Code blocks
    /^#{1,6}\s+/m,       // Headers
    /^\s*>\s+/m          // Blockquotes
  ]
  
  return patterns.some(pattern => pattern.test(content))
}

/**
 * Generate a preview of message content
 */
export function generateMessagePreview(content: string, maxLength: number = 100): string {
  // Remove markdown formatting for preview
  let preview = content
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, '• ')
    .replace(/^\s*>\s+/gm, '')
    .trim()
  
  if (preview.length > maxLength) {
    preview = preview.substring(0, maxLength).trim() + '...'
  }
  
  return preview
}

/**
 * Detect message intent based on content
 */
export function detectMessageIntent(content: string): {
  intent: string
  confidence: number
  keywords: string[]
} {
  const intents = [
    {
      name: 'job_creation',
      keywords: ['create job', 'new job', 'job posting', 'hire', 'position'],
      patterns: [/create.*job/i, /new.*position/i, /job.*posting/i]
    },
    {
      name: 'candidate_search',
      keywords: ['find candidate', 'search candidate', 'candidate', 'resume'],
      patterns: [/find.*candidate/i, /search.*candidate/i, /candidate.*search/i]
    },
    {
      name: 'analytics',
      keywords: ['report', 'analytics', 'metrics', 'statistics', 'data'],
      patterns: [/generate.*report/i, /show.*analytics/i, /hiring.*metrics/i]
    },
    {
      name: 'help',
      keywords: ['help', 'how to', 'what can', 'assist'],
      patterns: [/help.*me/i, /how.*to/i, /what.*can.*you/i]
    }
  ]
  
  let bestMatch = { intent: 'general', confidence: 0, keywords: [] as string[] }
  
  for (const intent of intents) {
    let score = 0
    const foundKeywords: string[] = []
    
    // Check keywords
    for (const keyword of intent.keywords) {
      if (content.toLowerCase().includes(keyword.toLowerCase())) {
        score += 1
        foundKeywords.push(keyword)
      }
    }
    
    // Check patterns
    for (const pattern of intent.patterns) {
      if (pattern.test(content)) {
        score += 2
      }
    }
    
    const confidence = Math.min(score / (intent.keywords.length + intent.patterns.length), 1)
    
    if (confidence > bestMatch.confidence) {
      bestMatch = {
        intent: intent.name,
        confidence,
        keywords: foundKeywords
      }
    }
  }
  
  return bestMatch
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(date: Date, format: 'short' | 'long' | 'relative' = 'short'): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (format === 'relative') {
    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }
  
  if (format === 'long') {
    return date.toLocaleString()
  }
  
  // Short format (default)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Sanitize message content for security
 */
export function sanitizeMessageContent(content: string): string {
  // Remove potentially dangerous HTML/JS
  return content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
}

/**
 * Check if content is likely AI-generated response vs user input
 */
export function isLikelyAIResponse(content: string): boolean {
  const aiIndicators = [
    /I'm an AI/i,
    /As an AI/i,
    /I can help you/i,
    /Here's what I found/i,
    /Based on the data/i,
    /Let me analyze/i,
    /I'd be happy to/i
  ]
  
  return aiIndicators.some(pattern => pattern.test(content))
} 