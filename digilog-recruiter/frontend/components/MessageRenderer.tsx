"use client"

import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Button } from "@/components/ui/button"
import { toast } from "@/hooks/use-toast"

// Custom markdown components for better formatting
const MarkdownComponents = {
  code({ node, inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '')
    return !inline && match ? (
      <SyntaxHighlighter
        style={oneDark}
        language={match[1]}
        PreTag="div"
        className="rounded-md my-2"
        {...props}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    ) : (
      <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
        {children}
      </code>
    )
  },
  h1: ({ children }: any) => <h1 className="text-2xl font-bold mt-6 mb-4 text-gray-900 dark:text-gray-100">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-xl font-semibold mt-5 mb-3 text-gray-900 dark:text-gray-100">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-lg font-medium mt-4 mb-2 text-gray-900 dark:text-gray-100">{children}</h3>,
  p: ({ children }: any) => <p className="mb-3 leading-relaxed text-gray-700 dark:text-gray-300">{children}</p>,
  ul: ({ children }: any) => <ul className="list-disc list-inside mb-3 space-y-1 text-gray-700 dark:text-gray-300">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal list-inside mb-3 space-y-1 text-gray-700 dark:text-gray-300">{children}</ol>,
  li: ({ children }: any) => <li className="ml-2">{children}</li>,
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-4 border-blue-500 pl-4 py-2 my-3 bg-blue-50 dark:bg-blue-900/20 italic text-gray-700 dark:text-gray-300">
      {children}
    </blockquote>
  ),
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-4">
      <table className="min-w-full border border-gray-200 dark:border-gray-700 rounded-lg">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: any) => (
    <th className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-left font-semibold text-gray-900 dark:text-gray-100">
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">
      {children}
    </td>
  ),
  strong: ({ children }: any) => <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>,
  em: ({ children }: any) => <em className="italic text-gray-700 dark:text-gray-300">{children}</em>,
  a: ({ children, href }: any) => (
    <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
}

interface MessageRendererProps {
  content: string
  isUser?: boolean
  onActionClick?: (action: string, data: any) => void
}

/**
 * Smart message renderer that handles both markdown and HTML content
 * Filters out HTML comments and technical data while preserving user-friendly formatting
 */
export default function MessageRenderer({ content, isUser = false, onActionClick }: MessageRendererProps) {
  /**
   * Clean content by removing HTML comments and technical artifacts
   * while preserving user-friendly formatting
   */
  const cleanContent = (rawContent: string): string => {
    let cleaned = rawContent

    // Remove HTML comments (they contain technical data not meant for users)
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')

    // Remove any leftover JSON code blocks that might be technical artifacts
    cleaned = cleaned.replace(/```json\s*\{[\s\S]*?\}\s*```/g, '')

    // Clean up extra whitespace that might be left after removing comments
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n')
    cleaned = cleaned.trim()

    return cleaned
  }

  /**
   * Extract and render action buttons from content
   */
  const renderWithActionButtons = (rawContent: string) => {
    const cleanedContent = cleanContent(rawContent)
    
    // Check if content contains action buttons - updated for candidate buttons too
    const jobButtonRegex = /<button\s+data-action="([^"]+)"\s+data-job-id="([^"]+)">([^<]+)<\/button>/g
    const candidateButtonRegex = /<button\s+data-action="([^"]+)"\s+data-candidate-id="([^"]+)">([^<]+)<\/button>/g
    const generalButtonRegex = /<button\s+data-action="([^"]+)"\s+data-url="([^"]+)">([^<]+)<\/button>/g
    const paginationButtonRegex = /<button\s+data-action="([^"]+)"\s+data-page="([^"]+)">([^<]+)<\/button>/g
    
    const buttons: Array<{ action: string; data: any; text: string }> = []
    let match
    
    // Job buttons
    while ((match = jobButtonRegex.exec(cleanedContent)) !== null) {
      buttons.push({
        action: match[1],
        data: { jobId: match[2] },
        text: match[3]
      })
    }
    
    // Candidate buttons
    while ((match = candidateButtonRegex.exec(cleanedContent)) !== null) {
      buttons.push({
        action: match[1],
        data: { candidateId: match[2] },
        text: match[3]
      })
    }
    
    // General navigation buttons
    while ((match = generalButtonRegex.exec(cleanedContent)) !== null) {
      buttons.push({
        action: match[1],
        data: { url: match[2] },
        text: match[3]
      })
    }
    
    // Pagination buttons
    while ((match = paginationButtonRegex.exec(cleanedContent)) !== null) {
      buttons.push({
        action: match[1],
        data: { page: match[2] },
        text: match[3]
      })
    }
    
    // Remove all button tags from content for markdown rendering
    const contentWithoutButtons = cleanedContent
      .replace(jobButtonRegex, '')
      .replace(candidateButtonRegex, '')
      .replace(generalButtonRegex, '')
      .replace(paginationButtonRegex, '')
      .trim()
    
    return { contentWithoutButtons, buttons }
  }

  /**
   * Handle action button clicks
   */
  const handleActionClick = (action: string, data: any) => {
    console.log('🔧 MessageRenderer: Button clicked!', { action, data })
    
    if (onActionClick) {
      onActionClick(action, data)
    } else {
      // Default behavior if no handler provided
      switch (action) {
        case 'view-job':
          toast({
            title: "View Job",
            description: `Opening job details for ID: ${data.jobId}`,
          })
          break
        case 'edit-job':
          toast({
            title: "Edit Job",
            description: `Opening job editor for ID: ${data.jobId}`,
          })
          break
        case 'find-candidates':
          toast({
            title: "Find Candidates",
            description: `Searching candidates for job ID: ${data.jobId}`,
          })
          break
        case 'job-analytics':
          toast({
            title: "Job Analytics",
            description: `Loading analytics for job ID: ${data.jobId}`,
          })
          break
        case 'discuss-candidate':
          toast({
            title: "Discuss Candidate",
            description: `Starting discussion about candidate ID: ${data.candidateId}`,
          })
          break
        case 'analyze-candidate':
          toast({
            title: "Analyze Candidate",
            description: `Analyzing candidate ID: ${data.candidateId}`,
          })
          break
        case 'navigate':
          toast({
            title: "Navigation",
            description: `Opening page: ${data.url}`,
          })
          // You could add actual navigation here: window.open(data.url, '_blank')
          break
        case 'paginate':
          toast({
            title: "Pagination",
            description: `Loading page ${data.page}`,
          })
          break
        default:
          toast({
            title: "Action",
            description: `Performing action: ${action}`,
          })
      }
    }
  }

  if (isUser) {
    // For user messages, just render as plain text with proper formatting
    return <div className="whitespace-pre-wrap">{cleanContent(content)}</div>
  }

  // For assistant messages, check for action buttons and render accordingly
  const { contentWithoutButtons, buttons } = renderWithActionButtons(content)

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-gray-900 dark:prose-headings:text-gray-100 prose-p:text-gray-700 dark:prose-p:text-gray-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MarkdownComponents}
      >
        {contentWithoutButtons}
      </ReactMarkdown>
      
      {/* Render action buttons if present */}
      {buttons.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 relative z-10">
          <div className="flex flex-wrap gap-2">
            {buttons.map((button, index) => (
              <Button
                key={index}
                variant="outline"
                size="sm"
                onClick={() => handleActionClick(button.action, button.data)}
                className="text-sm hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-900/20 dark:hover:border-blue-600 relative z-10 cursor-pointer"
                style={{ pointerEvents: 'auto' }}
              >
                {button.text}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
} 