"use client"

import React, { useState, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import "./assistant.css"
import mammoth from 'mammoth'
import {
  Send,
  Paperclip,
  Mic,
  Bot,
  User,
  Sparkles,
  FileText,
  Users,
  Briefcase,
  BarChart3,
  Search,
  Plus,
  Menu,
  X,
  Edit3,
  Trash2,
  MessageSquare,
  Clock,
  ChevronRight,
  Zap,
  TrendingUp,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  Edit2,
  Target,
  UserPlus,
  FileSearch,
  Brain,
  Lightbulb,
  CheckCircle,
  Pin,
  PinOff,
  ExternalLink,
  Copy,
  Loader2,
  Stars,
  Wand2,
  Rocket,
  Heart,
  MessageCircle,
  Settings,
  Globe,
  Shield,
  Save,
  ArrowRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import assistantService, { AssistantMessage } from "@/services/assistantService"
import { useUser } from "@/context/UserContext"
import useWebSocket from "@/hooks/useWebSocket"
import ThinkingProcess from "@/components/ThinkingProcess"
import MessageRenderer from "@/components/MessageRenderer"
import { GuideRenderer } from "@/components/ai-assistant/GuideRenderer"

// Chat Session Interface
interface ChatSession {
  sessionId: string
  title: string
  lastMessage?: {
    content: string
    timestamp: string
    type: 'user' | 'assistant'
  }
  messageCount: number
  isPinned: boolean
  lastActivity: string
  metadata?: {
    intent?: string
    topics?: string[]
  }
}

// Enhanced suggested prompts - Information and navigation focused
const suggestedPrompts = [
  {
    text: "How do I create a job posting?",
    icon: <Briefcase className="h-5 w-5" />,
    category: "job_creation",
    gradient: "from-blue-500 to-cyan-500",
    followUp: "I'll show you how to create a job posting step-by-step with a navigation button.",
    action: "navigate"
  },
  {
    text: "Where can I find candidates?",
    icon: <Users className="h-5 w-5" />,
    category: "candidate_search", 
    gradient: "from-purple-500 to-pink-500",
    followUp: "I'll direct you to the Candidates page where you can search and filter candidates."
  },
  {
    text: "Show me where to view jobs",
    icon: <Search className="h-5 w-5" />,
    category: "job_listing",
    gradient: "from-green-500 to-emerald-500",
    followUp: "I'll take you to the Jobs page where you can see all your postings..."
  },
  {
    text: "Where are analytics located?",
    icon: <BarChart3 className="h-5 w-5" />,
    category: "analytics",
    gradient: "from-orange-500 to-red-500",
    followUp: "I'll show you where to find recruitment analytics and reports..."
  },
  {
    text: "Generate interview questions for a role",
    icon: <FileText className="h-5 w-5" />,
    category: "content_generation",
    gradient: "from-indigo-500 to-purple-500",
    followUp: "I can generate interview questions for any role. What position are you hiring for?"
  },
  {
    text: "How do I schedule an interview?",
    icon: <Clock className="h-5 w-5" />,
    category: "interview_guide",
    gradient: "from-teal-500 to-blue-500",
    followUp: "I'll guide you through the interview scheduling process."
  },
]

// REMOVED: Job Application Form Component - AI Assistant is information-only
// Users must use the actual Jobs page to create jobs

// Enhanced Chat Session Item Component with modern design
function ChatSessionItem({ 
  session, 
  isActive, 
  onClick, 
  onDelete, 
  onEdit,
  onPin 
}: {
  session: ChatSession
  isActive: boolean
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
  onEdit: (e: React.MouseEvent) => void
  onPin: (e: React.MouseEvent) => void
}) {
  const formatDate = (date: string) => {
    const d = new Date(date)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString()
  }

  return (
    <div
      onClick={onClick}
      className={`group relative flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all duration-300 ease-out transform hover:scale-[1.02] ${
        isActive
          ? "bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 shadow-lg border border-blue-200/50 dark:border-blue-700/50"
          : "hover:bg-white/80 dark:hover:bg-gray-800/80 hover:shadow-md backdrop-blur-sm"
      }`}
    >
      {/* Active indicator */}
      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-r-full" />
      )}
      
      {/* Conversation Icon */}
      <div className={`flex items-center gap-3 flex-1 min-w-0 ${isActive ? 'ml-3' : ''}`}>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-300 ${
          isActive 
            ? 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg' 
            : 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 group-hover:from-blue-100 group-hover:to-indigo-100 dark:group-hover:from-blue-900/30 dark:group-hover:to-indigo-900/30'
        }`}>
          <MessageCircle className={`h-5 w-5 transition-colors duration-300 ${
            isActive ? 'text-white' : 'text-muted-foreground dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400'
          }`} />
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-semibold truncate transition-colors duration-300 ${
            isActive 
              ? 'text-blue-900 dark:text-blue-100' 
              : 'text-gray-800 dark:text-gray-100 group-hover:text-blue-800 dark:group-hover:text-blue-200'
          }`}>
            {session.title}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground dark:text-gray-400 mt-1">
            <Clock className="h-3 w-3" />
            <span>{formatDate(session.lastActivity)}</span>
            {session.messageCount > 0 && (
              <>
                <span className="text-gray-300 dark:text-muted-foreground">•</span>
                <Badge variant="secondary" className="text-xs px-1.5 py-0.5 h-auto">
                  {session.messageCount}
                </Badge>
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Action buttons with enhanced design */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all duration-200"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(e);
          }}
          title="Delete chat"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export default function AssistantPage() {
  const { toast } = useToast()
  const router = useRouter()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { state } = useUser()
  const user = state.user
  
  // WebSocket connection
  const {
    isConnected,
    isConnecting,
    sendChat,
    thinkingMessages,
    finalResult,
    isProcessing,
    error: wsError,
    clearThinking
  } = useWebSocket()
  
  // Chat Sessions State
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [currentChatSession, setCurrentChatSession] = useState<ChatSession | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true) // Main sidebar collapsed by default
  
  // Messages State
  const [messages, setMessages] = useState<AssistantMessage[]>([]) // AssistantMessage is imported, not defined here
  const [inputValue, setInputValue] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [isAssistantTyping, setIsAssistantTyping] = useState(false)
  
  // UI State
  const [confidence, setConfidence] = useState(0)
  const [processingTime, setProcessingTime] = useState(0)
  const [totalInteractions, setTotalInteractions] = useState(0)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  
  // File Parsing State
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parsedFileContent, setParsedFileContent] = useState<string | null>(null)
  const [isFileParsing, setIsFileParsing] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  
  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // REMOVED: Job Application Form State - AI Assistant no longer creates jobs

  // PDF.js worker is now configured dynamically in parsePDF function
  
  // Load chat sessions on mount
  useEffect(() => {
    loadChatSessions()
  }, [])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'; // Reset height to correctly calculate scrollHeight
      const maxHeight = 120; // Corresponds to max-h-[120px] (7.5rem * 16px/rem)
      const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [inputValue]);

  // Handle WebSocket final result
  useEffect(() => {
    if (finalResult && !isProcessing) {
      // Check if this is a job form trigger
      const jobFormTriggerMatch = finalResult.match(/<!-- JOB_FORM_TRIGGER:(.*?) -->/);
      
      if (jobFormTriggerMatch) {
        console.log('🚀 Job form trigger detected in response');
        
        try {
          // Parse the initial job data from the trigger
          const initialJobData = JSON.parse(jobFormTriggerMatch[1] || '{}');
          
          // Remove the trigger comment from the content
          const cleanContent = finalResult.replace(/<!-- JOB_FORM_TRIGGER:.*? -->/, '').trim();
          
          // Replace the loading message with the assistant's response
          setMessages(prev => {
            const newMessages = [...prev];
            const lastLoadingIndex = newMessages.findLastIndex(msg => msg.isLoading && msg.type === 'assistant');
            
            if (lastLoadingIndex !== -1) {
              newMessages[lastLoadingIndex] = {
                id: `assistant-${Date.now()}`,
                type: 'assistant',
                content: cleanContent,
                timestamp: new Date(),
                isLoading: false
              };
            } else {
              newMessages.push({
                id: `assistant-${Date.now()}`,
                type: 'assistant',
                content: cleanContent,
                timestamp: new Date()
              });
            }
            
            // REMOVED: Job form message creation - AI Assistant no longer creates jobs directly
            
            return newMessages;
          });
          
        } catch (error) {
          console.error('Error parsing job form trigger data:', error);
          // Fallback to regular message processing
          handleRegularMessage();
        }
      } else {
        // Regular message processing
        handleRegularMessage();
      }
      
      setIsAssistantTyping(false);
      
      // Clear thinking process after a short delay
      setTimeout(() => {
        clearThinking();
      }, 2000);

      // Refresh chat sessions list to pick up title changes
      setTimeout(() => {
        loadChatSessions();
      }, 3000); // Wait a bit longer to ensure backend title generation is complete
    }
    
    function handleRegularMessage() {
      setMessages(prev => {
        const newMessages = [...prev];
        
        // Check if the response contains guide data
        let guideData = null;
        let contentToDisplay = finalResult || '';
        
        if (finalResult) {
          try {
            // Look for GUIDE_DATA marker in the response (using multiline matching)
            const guideStartMarker = '<!-- GUIDE_DATA:';
            const guideEndMarker = ' -->';
            const startIndex = finalResult.indexOf(guideStartMarker);
            
            if (startIndex !== -1) {
              const dataStart = startIndex + guideStartMarker.length;
              const endIndex = finalResult.indexOf(guideEndMarker, dataStart);
              
              if (endIndex !== -1) {
                const guideJson = finalResult.substring(dataStart, endIndex);
                guideData = JSON.parse(guideJson);
                // Remove the marker from content
                contentToDisplay = (finalResult.substring(0, startIndex) + finalResult.substring(endIndex + guideEndMarker.length)).trim();
                console.log('📚 Guide data detected:', guideData);
              }
            }
          } catch (error) {
            console.error('Error parsing guide data:', error);
          }
        }
        
        // Find the last loading message and replace it
        const lastLoadingIndex = newMessages.findLastIndex(msg => msg.isLoading && msg.type === 'assistant');
        
        const messageData: any = {
          id: `assistant-${Date.now()}`,
          type: 'assistant',
          content: contentToDisplay,
          timestamp: new Date(),
          isLoading: false
        };
        
        // Attach guide data if found
        if (guideData) {
          messageData.guideData = guideData;
        }
        
        if (lastLoadingIndex !== -1) {
          newMessages[lastLoadingIndex] = messageData;
        } else {
          // Fallback: add new message if no loading message found
          delete messageData.isLoading;
          newMessages.push(messageData);
        }
        
        return newMessages;
      });
    }
  }, [finalResult, isProcessing, clearThinking])

  // Handle streaming chunks as they arrive (for real-time display)
  useEffect(() => {
    if (isProcessing && thinkingMessages.length > 0) {
      // Extract and concatenate LLM content chunks
      const llmChunks = thinkingMessages
        .filter(msg => msg.type === 'llm' && msg.content)
        .map(msg => msg.content)
        .join('');
      
      if (llmChunks) {
        // Update the loading message with streaming content
        setMessages(prev => {
          const newMessages = [...prev];
          const lastLoadingIndex = newMessages.findLastIndex(msg => msg.isLoading && msg.type === 'assistant');
          
          if (lastLoadingIndex !== -1) {
            // Update the loading message with the current streamed content
            newMessages[lastLoadingIndex] = {
              ...newMessages[lastLoadingIndex],
              content: llmChunks,
              isLoading: true // Keep it as loading until complete
            };
          }
          
          return newMessages;
        });
      }
    }
  }, [thinkingMessages, isProcessing]);

  // Handle WebSocket errors
  useEffect(() => {
    if (wsError) {
      toast({
        title: "Connection Error",
        description: wsError,
        variant: "destructive"
      })
    }
  }, [wsError, toast])

  // Load chat sessions
  const loadChatSessions = async () => {
    setLoadingSessions(true)
    try {
      const response = await assistantService.getChatSessions(50)
      setChatSessions(response.sessions || [])
      
      // Auto-load the most recent session if no session is selected
      if (!currentChatSession && response.sessions?.length > 0) {
        // Prioritize pinned sessions
        const pinnedSessions = response.sessions.filter((s: any) => s.isPinned)
        const sessionToLoad = pinnedSessions.length > 0 ? pinnedSessions[0] : response.sessions[0]
        await selectChatSession(sessionToLoad)
      } else if (!currentChatSession && (!response.sessions || response.sessions.length === 0)) {
        // If no chat sessions exist, show the welcome message with guide
        const welcomeGuide = {
          type: 'guide' as const,
          intent: 'welcome',
          title: '👋 Welcome to SmartHR Assistant!',
          introduction: "I'm your guide to navigating and using the SmartHR platform. I don't perform actions for you - instead, I show you how to do things yourself!",
          steps: [
            {
              number: 1,
              title: 'Ask Me for Help',
              description: 'Simply ask me how to do something, like "How do I create a job?" or "How do I find candidates?"',
              tip: 'I understand natural language - just ask like you\'re talking to a colleague'
            },
            {
              number: 2,
              title: 'Follow the Guides',
              description: 'I\'ll provide step-by-step instructions, helpful tips, and direct links to the right pages.',
              tip: 'Each guide includes navigation cards with "Go to Page" buttons'
            },
            {
              number: 3,
              title: 'Learn Features',
              description: 'Ask about specific features to learn how they work and when to use them.',
              tip: 'Examples: "How does AI matching work?" or "What is the hiring pipeline?"'
            }
          ],
          navigationCard: {
            title: '🚀 Quick Start',
            description: 'Get started with SmartHR in minutes',
            primaryButton: {
              label: 'Start Tutorial',
              url: '/tutorial',
              icon: 'GraduationCap'
            },
            secondaryButton: {
              label: 'Go to Dashboard',
              url: '/dashboard',
              icon: 'Home'
            }
          },
          tips: [
            'Ask me "How do I..." questions for any feature',
            'I can explain features, show you where to find things, and provide best practices',
            'Try: "How do I create a job?", "How do I add candidates?", or "How do I schedule interviews?"'
          ],
          commonTopics: [
            {
              title: 'Job Management',
              examples: [
                'How do I create a job?',
                'How do I view my jobs?',
                'How do I edit a job posting?'
              ]
            },
            {
              title: 'Candidate Management',
              examples: [
                'How do I add candidates?',
                'How do I search for candidates?',
                'How does AI matching work?'
              ]
            },
            {
              title: 'Interviews',
              examples: [
                'How do I schedule an interview?',
                'What is AI Notetaker?',
                'How do I set up interview stages?'
              ]
            },
            {
              title: 'Hiring Pipeline',
              examples: [
                'How do I use the hiring pipeline?',
                'How do I move candidates between stages?',
                'How do I configure stages?'
              ]
            }
          ]
        };
        
        const welcomeMessage: AssistantMessage = {
          id: "welcome",
          type: "assistant",
          content: "👋 Hi! I'm your SMART HR Assistant - your guide to navigating SmartHR!\n\nI'm here to help you learn how to use the platform. Just ask me how to do something, and I'll provide step-by-step instructions with helpful links.",
          timestamp: new Date(),
          guideData: welcomeGuide
        }
        setMessages([welcomeMessage])
      }
    } catch (error: any) {
      console.error('Error loading chat sessions:', error)
      toast({
        title: "Error",
        description: "Failed to load chat sessions",
        variant: "destructive"
      })
    } finally {
      setLoadingSessions(false)
    }
  }

  // Create new chat session
  const createNewChatSession = async () => {
    try {
      const response = await assistantService.createChatSession()
      const newSession = response.session
      
      // Add to sessions list
      setChatSessions(prev => [newSession, ...prev])
      
      // Select the new session
      await selectChatSession(newSession)
      
      toast({
        title: "New Chat Created",
        description: "Started a new conversation"
      })
    } catch (error: any) {
      toast({
        title: "Error Creating Chat",
        description: error.message || "Failed to create new chat session",
        variant: "destructive"
      })
    }
  }

  // Select a chat session
  const selectChatSession = async (session: ChatSession) => {
    try {
      setCurrentChatSession(session)
      
      // Load messages for this session
      const response = await assistantService.getChatSessionHistory(session.sessionId)
      
      // Convert history to messages format
      const sessionMessages: AssistantMessage[] = []
      
      if (response.history && response.history.length > 0) {
        response.history.forEach((item: any) => {
          if (item.messages) {
            item.messages.forEach((msg: any, index: number) => {
              sessionMessages.push({
                id: `${item.id}-${index}`,
                type: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content,
                timestamp: new Date(item.timestamp),
                metadata: item.metadata // Ensure metadata from history is preserved
              })
            })
          }
        })
      }
      
      // Add enhanced welcome message if no history
      if (sessionMessages.length === 0) {
        sessionMessages.push({
          id: "welcome",
          type: "assistant",
          content: "👋 Hi! I'm your SMART HR Assistant, powered by AI to help you manage recruitment efficiently.\n\nI can help you with:\n• 📝 Creating job postings\n• 🔍 Finding the best candidates\n• 📊 Analyzing recruitment data\n• 📅 Scheduling interviews\n• 📈 Generating reports\n\nWhat would you like to do today?",
          timestamp: new Date()
        })
      }
      
      setMessages(sessionMessages)
    } catch (error: any) {
      console.error('Error loading session:', error)
      
      if (error.message?.includes('Access denied')) {
        toast({
          title: "Session Access Issue",
          description: "This chat session may have been created before you logged in. Creating a new session...",
          variant: "default"
        })
        setChatSessions(prev => prev.filter(s => s.sessionId !== session.sessionId))
        await createNewChatSession()
      } else {
        toast({
          title: "Error Loading Session",
          description: error.message || "Failed to load chat session",
          variant: "destructive"
        })
      }
    }
  }

  // Delete chat session
  const deleteChatSession = async (sessionId: string) => {
    try {
      await assistantService.deleteChatSession(sessionId)
      setChatSessions(prev => prev.filter(s => s.sessionId !== sessionId))
      if (currentChatSession?.sessionId === sessionId) {
        setCurrentChatSession(null)
        setMessages([])
      }
      toast({
        title: "Chat Deleted",
        description: "Chat session has been deleted"
      })
    } catch (error: any) {
      toast({
        title: "Error Deleting Chat",
        description: error.message || "Failed to delete chat session",
        variant: "destructive"
      })
    }
  }

  // Update session title
  const updateSessionTitle = async (sessionId: string, newTitle: string) => {
    try {
      await assistantService.updateChatSessionTitle(sessionId, newTitle)
      setChatSessions(prev => prev.map(s => 
        s.sessionId === sessionId ? { ...s, title: newTitle } : s
      ))
      if (currentChatSession?.sessionId === sessionId) {
        setCurrentChatSession(prev => prev ? { ...prev, title: newTitle } : null)
      }
      setEditingSessionId(null)
      setEditingTitle("")
      toast({
        title: "Title Updated",
        description: "Chat session title has been updated"
      })
    } catch (error: any) {
      toast({
        title: "Error Updating Title",
        description: error.message || "Failed to update session title",
        variant: "destructive"
      })
    }
  }

  // Handle sending message using WebSocket
  const handleSendMessage = async () => {
    if (inputValue.trim() === "" || isAssistantTyping || isProcessing) return;

    // Check WebSocket connection
    if (!isConnected) {
      toast({
        title: "Connection Error",
        description: "Not connected to server. Please wait for reconnection.",
        variant: "destructive"
      });
      return;
    }

    // Ensure we have a chat session before sending a message
    let sessionToUse = currentChatSession;
    if (!currentChatSession) {
      try {
        const response = await assistantService.createChatSession();
        const newSession = response.session;
        setChatSessions(prev => [newSession, ...prev]);
        setCurrentChatSession(newSession);
        sessionToUse = newSession;
        console.log('Created new chat session:', newSession.sessionId);
      } catch (error: any) {
        toast({
          title: "Error Creating Chat",
          description: error.message || "Failed to create chat session",
          variant: "destructive"
        });
        return;
      }
    }

    // Prepare message content - combine input with parsed file content
    let messageContent = inputValue.trim()
    
    if (parsedFileContent && selectedFile) {
      messageContent += `\n\n--- Attached File: ${selectedFile.name} ---\n${parsedFileContent}`
    }

    const userMessage: AssistantMessage = {
      id: `user-${Date.now()}`,
      type: "user",
      content: messageContent,
      timestamp: new Date(),
    };

    // Add user message
    setMessages((prev) => [...prev, userMessage]);
    
    // Add loading message for AI response
    const loadingMessage: AssistantMessage = {
      id: `loading-${Date.now()}`,
      type: "assistant",
      content: "",
      timestamp: new Date(),
      isLoading: true
    };

    setMessages((prev) => [...prev, loadingMessage]);
    
    setInputValue("");
    setIsAssistantTyping(true);

    // Send message via WebSocket
    sendChat(
      messageContent,
      user?._id,
      sessionToUse?.sessionId,
      localStorage.getItem('jwt') || undefined
    );

    // Clear file attachment after sending
    if (selectedFile) {
      removeAttachedFile()
    }

    // Update session activity
    if (sessionToUse) {
      setChatSessions(prev => prev.map(session => 
        session.sessionId === sessionToUse.sessionId 
          ? {
              ...session,
              lastMessage: {
            content: messageContent.substring(0, 100) + (messageContent.length > 100 ? '...' : ''),
                timestamp: new Date().toISOString(),
            type: 'user' as const
              },
          messageCount: (session.messageCount || 0) + 1, 
              lastActivity: new Date().toISOString()
            }
          : session
      ));
    }
  };

  // Handle action click with enhanced intelligence
  const handleActionClick = async (action: string, data?: any) => {
    try {
      // Handle send_message action - sends a message to the chat
      if (action === 'send_message' && data?.message) {
        setInputValue(data.message)
        setTimeout(() => handleSendMessage(), 100)
        return
      }

      // Handle navigation actions
      if (action === 'navigate' && data?.url) {
        router.push(data.url)
        return
      }

      // REMOVED: Job creation actions - AI Assistant is information-only
      // Users must navigate to the Jobs page to create jobs

      // Handle candidate actions
      if (action === 'view_candidate' && data?.candidateId) {
        router.push(`/candidates/${data.candidateId}`)
        return
      }

      // schedule_interview action is now handled by execute-action endpoint

      // Handle job matching
      // find_candidates_for_job action is now handled by execute-action endpoint

      // Handle job action buttons from MessageRenderer
      if (action === 'view-job' && data?.jobId) {
        router.push(`/jobs/${data.jobId}`)
        return
      }

      if (action === 'edit-job' && data?.jobId) {
        router.push(`/jobs/${data.jobId}/edit`)
        return
      }

      if (action === 'find-candidates' && data?.jobId) {
        const findCandidatesMessage = `Find the best matching candidates for job ID ${data.jobId}`
        setInputValue(findCandidatesMessage)
        setTimeout(() => handleSendMessage(), 100)
        return
      }

      if (action === 'job-analytics' && data?.jobId) {
        const analyticsMessage = `Show analytics and statistics for job ID ${data.jobId}`
        setInputValue(analyticsMessage)
        setTimeout(() => handleSendMessage(), 100)
        return
      }

      // Handle show main menu - Navigation only
      if (action === 'show_main_menu') {
        const menuMessage: AssistantMessage = {
          id: `assistant-menu-${Date.now()}`,
          type: "assistant",
          content: "Here's what I can help you find:",
          timestamp: new Date(),
          actions: [
            { label: "View Jobs", icon: "briefcase", action: "navigate", data: { url: "/jobs" } },
            { label: "View Candidates", icon: "users", action: "navigate", data: { url: "/candidates" } },
            { label: "View Dashboard", icon: "bar-chart", action: "navigate", data: { url: "/" } },
            { label: "Upload CVs", icon: "upload", action: "navigate", data: { url: "/bulk-upload" } },
            { label: "View Calendar", icon: "calendar", action: "navigate", data: { url: "/calendar" } }
          ]
        }
        setMessages(prev => [...prev, menuMessage])
        return
      }

      // Handle repeat last action
      if (action === 'repeat_last_action') {
        // Find the last user message that wasn't a menu selection
        const lastUserMessage = messages.filter(m => m.type === 'user' && !m.content.includes('What would you like to do')).pop()
        if (lastUserMessage) {
          setInputValue(lastUserMessage.content)
          setTimeout(() => handleSendMessage(), 100)
        }
        return
      }

      // Default action handling via API
      const response = await assistantService.executeAction(action, data)
      
      // Handle specific action responses
      if (response.success && response.action === 'analyze-candidate' && response.result) {
        const candidate = response.result
        
        // Format candidate analysis for display
        let analysisContent = `# 🔬 **Candidate Analysis: ${candidate.candidateName}**\n\n`
        
        // Basic Information
        analysisContent += `## 📋 **Basic Information**\n\n`
        analysisContent += `- **Position:** ${candidate.position}\n`
        analysisContent += `- **Experience:** ${candidate.experience}\n`
        analysisContent += `- **Location:** ${candidate.location}\n`
        analysisContent += `- **Education:** ${candidate.education}\n`
        analysisContent += `- **Status:** ${candidate.status}\n\n`
        
        // Skills
        if (candidate.skills) {
          analysisContent += `## 💼 **Skills**\n\n`
          analysisContent += `${candidate.skills}\n\n`
        }
        
        // AI Analysis
        if (candidate.aiAnalysis) {
          const analysis = candidate.aiAnalysis
          
          analysisContent += `## 🤖 **AI Analysis**\n\n`
          
          if (analysis.summary) {
            analysisContent += `**Summary:** ${analysis.summary}\n\n`
          }
          
          if (analysis.strengths && analysis.strengths.length > 0) {
            analysisContent += `### ✅ **Strengths**\n\n`
            analysis.strengths.forEach((strength: string) => {
              analysisContent += `- ✅ ${strength}\n`
            })
            analysisContent += '\n'
          }
          
          if (analysis.potentialFlags && analysis.potentialFlags.length > 0) {
            analysisContent += `### ⚠️ **Areas for Consideration**\n\n`
            analysis.potentialFlags.forEach((flag: string) => {
              analysisContent += `- ⚠️ ${flag}\n`
            })
            analysisContent += '\n'
          }
        }
        
        // Add action buttons
        analysisContent += `---\n\n`
        
        const analysisMessage: AssistantMessage = {
          id: `analysis-${Date.now()}`,
          type: "assistant",
          content: analysisContent,
          timestamp: new Date(),
          metadata: { 
            intent: 'candidate_analysis',
            candidateId: candidate.candidateId
          },
                     actions: [
             { label: "View Full Profile", icon: "external-link", action: "navigate", data: { url: `/candidates/${candidate.candidateId}` } },
             { label: "Schedule Interview", icon: "calendar", action: "schedule_interview", data: { candidateId: candidate.candidateId } },
             { label: "View Resume", icon: "file-text", action: "navigate", data: { url: candidate.resumeUrl } },
             { label: "Discuss Further", icon: "message", action: "discuss-candidate", data: { candidateId: candidate.candidateId } }
           ]
        }
        
        setMessages(prev => [...prev, analysisMessage])
        
        toast({
          title: "✅ Analysis Complete",
          description: `Generated detailed analysis for ${candidate.candidateName}`
        })
        
      } else if (response.success && response.action === 'analyze-job' && response.result) {
        // Handle job analysis similarly
        const job = response.result
        
        let jobContent = `# 🎯 **Job Analysis: ${job.title}**\n\n`
        jobContent += `## 📋 **Job Details**\n\n`
        jobContent += `- **Department:** ${job.department}\n`
        jobContent += `- **Status:** ${job.status}\n`
        jobContent += `- **Applicants:** ${job.applicants}\n`
        jobContent += `- **Location:** ${job.location}\n`
        jobContent += `- **Created:** ${new Date(job.createdAt).toLocaleDateString()}\n\n`
        
        if (job.requirements) {
          jobContent += `## 📋 **Requirements**\n\n${job.requirements}\n\n`
        }
        
        if (job.responsibilities) {
          jobContent += `## 🎯 **Responsibilities**\n\n${job.responsibilities}\n\n`
        }
        
        if (job.skills) {
          jobContent += `## 💼 **Required Skills**\n\n${job.skills}\n\n`
        }
        
        jobContent += `---\n\n`
        
        const jobMessage: AssistantMessage = {
          id: `job-analysis-${Date.now()}`,
          type: "assistant", 
          content: jobContent,
          timestamp: new Date(),
          metadata: { intent: 'job_analysis' },
          actions: [
            { label: "View Job Posting", icon: "external-link", action: "navigate", data: { url: `/jobs/${job.jobId}` } },
            { label: "Find Candidates", icon: "users", action: "find_candidates_for_job", data: { jobId: job.jobId } },
            { label: "Edit Job", icon: "edit", action: "navigate", data: { url: `/jobs/${job.jobId}/edit` } }
          ]
        }
        
        setMessages(prev => [...prev, jobMessage])
        
        toast({
          title: "✅ Job Analysis Complete",
          description: `Generated analysis for ${job.title}`
        })
        
      } else if (response.success && response.action === 'discuss-candidate' && response.result) {
        // Handle candidate discussion
        const candidate = response.result
        
        let discussionContent = `# 💬 **Let's Discuss: ${candidate.candidateName}**\n\n`
        
        // Basic overview
        discussionContent += `I'd be happy to discuss **${candidate.candidateName}**, who is a **${candidate.position}** candidate with **${candidate.experience}** experience.\n\n`
        
        // Quick overview
        discussionContent += `## 📋 **Quick Overview**\n\n`
        discussionContent += `- **Position:** ${candidate.position}\n`
        discussionContent += `- **Experience:** ${candidate.experience}\n`
        discussionContent += `- **Location:** ${candidate.location}\n`
        discussionContent += `- **Status:** ${candidate.status}\n\n`
        
        // Discussion prompt
        if (candidate.discussionPrompt) {
          discussionContent += `${candidate.discussionPrompt}\n\n`
        }
        
        // Conversation starters
        discussionContent += `## 🤔 **What would you like to know?**\n\n`
        discussionContent += `Here are some things we can discuss:\n\n`
        discussionContent += `- Their technical skills and experience\n`
        discussionContent += `- How they might fit with our team\n`
        discussionContent += `- Their career progression and growth potential\n`
        discussionContent += `- Interview focus areas and questions\n`
        discussionContent += `- Compensation expectations and logistics\n\n`
        
        discussionContent += `Feel free to ask me anything about ${candidate.candidateName}! 😊\n\n`
        
        const discussionMessage: AssistantMessage = {
          id: `discussion-${Date.now()}`,
          type: "assistant",
          content: discussionContent,
          timestamp: new Date(),
          metadata: { 
            intent: 'candidate_discussion',
            candidateId: candidate.candidateId
          },
          actions: [
            { label: "Full Analysis", icon: "search", action: "analyze-candidate", data: { candidateId: candidate.candidateId } },
            { label: "View Profile", icon: "external-link", action: "navigate", data: { url: `/candidates/${candidate.candidateId}` } },
            { label: "Schedule Interview", icon: "calendar", action: "schedule_interview", data: { candidateId: candidate.candidateId } }
          ]
        }
        
        setMessages(prev => [...prev, discussionMessage])
        
        toast({
          title: "💬 Ready to Discuss",
          description: `Let's talk about ${candidate.candidateName}`
        })
        
      } else if (response.success && response.action === 'schedule_interview' && response.result) {
        // Handle interview scheduling guidance
        const candidate = response.result
        
        let schedulingContent = `# 📅 **Schedule Interview: ${candidate.candidateName}**\n\n`
        
        // Candidate overview
        schedulingContent += `To schedule an interview with **${candidate.candidateName}** for the **${candidate.position}** position, please follow the proper workflow:\n\n`
        
        if (candidate.email || candidate.phone) {
          schedulingContent += `## 📞 **Candidate Contact**\n\n`
          if (candidate.email) {
            schedulingContent += `- **Email:** ${candidate.email}\n`
          }
          if (candidate.phone) {
            schedulingContent += `- **Phone:** ${candidate.phone}\n`
          }
          schedulingContent += '\n'
        }
        
        // Proper workflow steps
        if (candidate.schedulingSteps) {
          schedulingContent += `## 📋 **Proper Interview Scheduling Workflow**\n\n`
          candidate.schedulingSteps.forEach((step: any) => {
            schedulingContent += `### **Step ${step.step}: ${step.title}**\n`
            schedulingContent += `${step.description}\n\n`
          })
        }
        
        // Workflow note
        if (candidate.workflowNote) {
          schedulingContent += `> **💡 Important:** ${candidate.workflowNote}\n\n`
        }
        
        schedulingContent += `## 🚀 **Start the Process**\n\n`
        schedulingContent += `Click the button below to begin the interview scheduling workflow.\n\n`
        
        const schedulingMessage: AssistantMessage = {
          id: `scheduling-${Date.now()}`,
          type: "assistant",
          content: schedulingContent,
          timestamp: new Date(),
          metadata: { 
            intent: 'interview_scheduling',
            candidateId: candidate.candidateId
          },
          actions: [
            { label: "Go to Jobs", icon: "briefcase", action: "navigate", data: { url: "/jobs" } },
            { label: "View Candidate Profile", icon: "user", action: "navigate", data: { url: `/candidates/${candidate.candidateId}` } },
            { label: "Analyze Candidate", icon: "search", action: "analyze-candidate", data: { candidateId: candidate.candidateId } }
          ]
        }
        
        setMessages(prev => [...prev, schedulingMessage])
        
        toast({
          title: "📅 Interview Scheduling Guide",
          description: `Here's how to schedule an interview with ${candidate.candidateName}`
        })
        
      } else if (response.success && response.action === 'find_candidates_for_job' && response.result) {
        // Handle candidate search guidance
        const job = response.result
        
        let candidateSearchContent = `# 🔍 **Find Candidates: ${job.jobTitle}**\n\n`
        
        // Job overview
        candidateSearchContent += `Let's find the best candidates for the **${job.jobTitle}** position in **${job.department}**.\n\n`
        
        if (job.location) {
          candidateSearchContent += `**Location:** ${job.location}\n`
        }
        candidateSearchContent += `**Status:** ${job.status}\n\n`
        
        // Search methods
        if (job.searchMethods) {
          candidateSearchContent += `## 🎯 **Search Methods Available**\n\n`
          job.searchMethods.forEach((method: any) => {
            candidateSearchContent += `### **${method.method}**\n`
            candidateSearchContent += `${method.description}\n\n`
          })
        }
        
        // Search tips
        if (job.searchTips) {
          candidateSearchContent += `## 💡 **Search Tips**\n\n`
          job.searchTips.forEach((tip: string) => {
            candidateSearchContent += `- 💡 ${tip}\n`
          })
          candidateSearchContent += '\n'
        }
        
        candidateSearchContent += `## 🚀 **Ready to Start Searching?**\n\n`
        candidateSearchContent += `Use the buttons below to access different search and matching tools.\n\n`
        
        const candidateSearchMessage: AssistantMessage = {
          id: `candidate-search-${Date.now()}`,
          type: "assistant",
          content: candidateSearchContent,
          timestamp: new Date(),
          metadata: { 
            intent: 'candidate_search',
            jobId: job.jobId
          },
          actions: [
            { label: "View All Candidates", icon: "users", action: "navigate", data: { url: "/candidates" } },
            { label: "AI Matching", icon: "search", action: "navigate", data: { url: `/jobs/${job.jobId}/matching` } },
            { label: "Job Details", icon: "external-link", action: "navigate", data: { url: `/jobs/${job.jobId}` } },
            { label: "Analyze Job", icon: "chart", action: "analyze-job", data: { jobId: job.jobId } }
          ]
        }
        
        setMessages(prev => [...prev, candidateSearchMessage])
        
        toast({
          title: "🔍 Candidate Search Guide",
          description: `Here's how to find candidates for ${job.jobTitle}`
        })
        
      } else {
        // Generic success handling
        toast({
          title: "Action Executed",
          description: response.message || "Action completed successfully"
        })
        
        // If the action returns a message, add it to chat
        if (response.message) {
          const actionMessage: AssistantMessage = {
            id: `action-${Date.now()}`,
            type: "assistant",
            content: response.message,
            timestamp: new Date(),
            metadata: { intent: 'action_result' }
          }
          
          setMessages(prev => [...prev, actionMessage])
        }
      }
    } catch (error: any) {
      toast({
        title: "Action Failed",
        description: error.message || "Failed to execute action",
        variant: "destructive"
      })
    }
  }

  // Handle suggested prompt with intelligent follow-up
  const handleSuggestedPrompt = async (prompt: typeof suggestedPrompts[0]) => {
    // Add the user's selection as a message
    const userMessage: AssistantMessage = {
      id: `user-${Date.now()}`,
      type: "user",
      content: prompt.text,
      timestamp: new Date()
    }
    setMessages(prev => [...prev, userMessage])

    // Add assistant's follow-up message
    const assistantMessage: AssistantMessage = {
      id: `assistant-${Date.now()}`,
      type: "assistant",
      content: prompt.followUp,
      timestamp: new Date(),
      metadata: { intent: prompt.category }
    }
    setMessages(prev => [...prev, assistantMessage])

    // For certain categories, immediately trigger actions
    if (prompt.category === 'job_listing' || prompt.category === 'analytics') {
      // Auto-send the request
      setInputValue(prompt.text)
      setTimeout(() => handleSendMessage(), 500)
    } else if (prompt.category === 'job_creation') {
      // REMOVED: Job creation form - users must use actual Jobs page
      // Send message to guide them instead
      setInputValue(prompt.text)
      setTimeout(() => handleSendMessage(), 500)
    } else if (prompt.category === 'cv_upload') {
      // Add upload action
      const actionMessage: AssistantMessage = {
        id: `assistant-action-${Date.now()}`,
        type: "assistant",
        content: "You can upload CVs in multiple ways:",
        timestamp: new Date(),
        actions: [
          { label: "Upload Single CV", icon: "upload", action: "navigate", data: { url: "/candidates/new" } },
          { label: "Bulk Upload CVs", icon: "upload", action: "navigate", data: { url: "/bulk-upload" } },
          { label: "Create Candidate Manually", icon: "plus", action: "navigate", data: { url: "/candidates/new" } }
        ]
      }
      setTimeout(() => setMessages(prev => [...prev, actionMessage]), 1000)
    }
  }

  // Format timestamp
  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Format session time
  const formatSessionTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (diffDays === 1) {
      return 'Yesterday'
    } else if (diffDays < 7) {
      return `${diffDays} days ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  // Copy message content
  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content)
    toast({
      title: "Copied",
      description: "Message copied to clipboard"
    })
  }

  const togglePinSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const response = await assistantService.toggleChatSessionPin(sessionId)
      
      setChatSessions(sessions => 
        sessions.map(s => 
          s.sessionId === sessionId 
            ? { ...s, isPinned: response.session.isPinned }
            : s
        ).sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1
          if (!a.isPinned && b.isPinned) return 1
          return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
        })
      )
      
      toast({
        title: response.session.isPinned ? "Session Pinned" : "Session Unpinned",
        description: response.msg,
      })
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to toggle pin status",
        variant: "destructive",
      })
    }
  }

  // Handle file upload
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
    
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Unsupported File Type",
        description: "Please select a PDF or Word document (.pdf, .doc, .docx)",
        variant: "destructive"
      })
      return
    }

    // Validate file size (5MB limit)
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (file.size > maxSize) {
      toast({
        title: "File Too Large",
        description: "Please select a file smaller than 5MB",
        variant: "destructive"
      })
      return
    }

    setSelectedFile(file)
    setFileError(null)
    setIsFileParsing(true)

    try {
      let extractedText = ""

      if (file.type === 'application/pdf') {
        extractedText = await parsePDF(file)
      } else if (file.type.includes('word') || file.name.endsWith('.docx')) {
        extractedText = await parseDOCX(file)
      }

      setParsedFileContent(extractedText)
      
      toast({
        title: "File Attached",
        description: `${file.name} has been processed and will be included with your message`,
      })
    } catch (error: any) {
      console.error('File parsing error:', error)
      setFileError(error.message || 'Failed to parse file')
      setSelectedFile(null)
      
      toast({
        title: "File Processing Error",
        description: error.message || 'Failed to parse the selected file',
        variant: "destructive"
      })
    } finally {
      setIsFileParsing(false)
    }
  }

  // Parse PDF file
  const parsePDF = async (file: File): Promise<string> => {
    // Dynamically import PDF.js to avoid SSR issues
    const pdfjsLib = await import('pdfjs-dist')
    
    // Configure the worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js'
    
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    
    let fullText = ""
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ')
      fullText += pageText + '\n'
    }
    
    return fullText.trim()
  }

  // Parse DOCX file
  const parseDOCX = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    return result.value
  }

  // Remove attached file
  const removeAttachedFile = () => {
    setSelectedFile(null)
    setParsedFileContent(null)
    setFileError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Trigger file input
  const triggerFileInput = () => {
    fileInputRef.current?.click()
  }

  // Job Application Form Handlers
  // REMOVED: Job creation handlers - AI Assistant no longer creates jobs directly
  // Users must use the actual Jobs page to create jobs

  return (
    <>
      <div className="fixed top-16 inset-x-0 bottom-0 bg-gradient-to-br from-white via-blue-50/50 to-indigo-50/60 dark:from-gray-950 dark:via-blue-950/20 dark:to-indigo-950/30 overflow-hidden">
        {/* Modern geometric background pattern */}
        <div className="absolute inset-0 opacity-30 dark:opacity-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(59,130,246,0.15)_1px,transparent_0)] bg-[length:24px_24px]" />
          <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_49%,rgba(59,130,246,0.05)_50%,transparent_51%)] bg-[length:20px_20px]" />
        </div>
        
        {/* Enhanced floating elements with better positioning */}
        <div className="absolute top-20 left-20 w-32 h-32 bg-gradient-to-br from-blue-400/10 via-purple-400/10 to-pink-400/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-32 right-32 w-40 h-40 bg-gradient-to-br from-indigo-400/10 via-blue-400/10 to-cyan-400/10 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/3 right-1/4 w-24 h-24 bg-gradient-to-br from-purple-400/10 via-pink-400/10 to-rose-400/10 rounded-full blur-2xl animate-pulse delay-500" />
        <div className="absolute bottom-1/4 left-1/3 w-28 h-28 bg-gradient-to-br from-emerald-400/10 via-teal-400/10 to-cyan-400/10 rounded-full blur-2xl animate-pulse delay-700" />

        <div className="flex h-full relative z-10">
        {/* Mobile Overlay */}
        {sidebarOpen && (
          <div 
            className="fixed top-16 inset-x-0 bottom-0 bg-black/50 backdrop-blur-sm z-20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* Modern Glass-morphism Sidebar */}
        <div className={`${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } transition-all duration-500 ease-out lg:translate-x-0
        fixed lg:relative top-16 lg:top-0 bottom-0 lg:bottom-0 left-0 z-30 lg:z-auto
        ${sidebarCollapsed ? 'lg:w-16' : 'w-64 sm:w-72 md:w-80 lg:w-64 xl:w-72'}
        flex-shrink-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl
        border-r border-gray-200/30 dark:border-gray-700/30 flex flex-col
        shadow-2xl lg:shadow-xl overflow-hidden`}>
          {/* Modern gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-blue-50/20 via-white/10 to-indigo-50/20 dark:from-blue-950/20 dark:via-gray-900/10 dark:to-indigo-950/20 pointer-events-none" />
          
          {/* Animated border glow */}
          <div className="absolute inset-0 bg-gradient-to-b from-blue-500/10 via-purple-500/5 to-indigo-500/10 opacity-0 hover:opacity-100 transition-all duration-700 blur-xl" />
          
          {/* Modern Sidebar Header */}
          <div className="relative px-4 py-4 border-b border-gray-200/30 dark:border-gray-700/30 bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              {!sidebarCollapsed ? (
                <>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div>
                      <h2 className="text-base font-bold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                        Chat History
                      </h2>
                      <p className="text-xs text-muted-foreground dark:text-gray-400 font-medium">
                        {chatSessions.length} conversations
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <Button
                      onClick={createNewChatSession}
                      size="icon"
                      className="h-8 w-8 bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-600 hover:from-blue-600 hover:via-purple-600 hover:to-indigo-700 shadow-lg hover:shadow-xl hover:shadow-blue-500/30 transition-all duration-300 border-0 rounded-lg transform hover:scale-105"
                      title="Start New Chat"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                      className="hidden lg:flex h-8 w-8 hover:bg-muted/50 dark:hover:bg-gray-800 rounded-lg"
                      title="Collapse Sidebar"
                    >
                      <ChevronRight className="h-4 w-4 rotate-180" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSidebarOpen(false)}
                      className="lg:hidden h-8 w-8 hover:bg-muted/50 dark:hover:bg-gray-800 rounded-lg"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-4 w-full">
                  <Button
                    onClick={() => setSidebarCollapsed(false)}
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 hover:bg-muted/50 dark:hover:bg-gray-800 rounded-lg"
                    title="Expand Sidebar"
                  >
                    <Menu className="h-5 w-5 text-muted-foreground dark:text-gray-400" />
                  </Button>
                  <Button
                    onClick={createNewChatSession}
                    size="icon"
                    className="h-10 w-10 bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-600 hover:from-blue-600 hover:via-purple-600 hover:to-indigo-700 shadow-lg hover:shadow-xl hover:shadow-blue-500/30 transition-all duration-300 border-0 rounded-lg transform hover:scale-105"
                    title="Start New Chat"
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Modern Sessions List */}
          {!sidebarCollapsed && (
            <ScrollArea className="flex-1 relative">
              <div className="p-3 space-y-2">
                {loadingSessions ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="text-center">
                      <div className="relative mb-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mx-auto shadow-lg">
                          <Loader2 className="h-6 w-6 animate-spin text-white" />
                        </div>
                        <div className="absolute inset-0 w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 animate-ping opacity-20 mx-auto" />
                      </div>
                      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">Loading conversations</h3>
                      <p className="text-xs text-muted-foreground dark:text-gray-400">Fetching your chat history...</p>
                      <div className="mt-3 flex justify-center space-x-1">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></div>
                        <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce delay-100"></div>
                        <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-200"></div>
                      </div>
                    </div>
                  </div>
                ) : chatSessions.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-100 via-purple-100 to-indigo-100 dark:from-blue-900/30 dark:via-purple-900/30 dark:to-indigo-900/30 flex items-center justify-center mx-auto mb-6 shadow-lg">
                      <MessageCircle className="h-8 w-8 text-blue-500 dark:text-blue-400" />
                    </div>
                    <h3 className="text-base font-bold text-gray-800 dark:text-gray-200 mb-2">No conversations yet</h3>
                    <p className="text-xs text-muted-foreground dark:text-gray-400 max-w-48 mx-auto leading-relaxed mb-4">
                      Start your first conversation with the AI assistant to see your chat history here
                    </p>
                    <Button
                      onClick={createNewChatSession}
                      size="sm"
                      className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 shadow-lg hover:shadow-xl transition-all duration-300"
                    >
                      <Plus className="h-3 w-3 mr-2" />
                      Start Chatting
                    </Button>
                  </div>
                ) : (
                  chatSessions.map((session) => (
                    <ChatSessionItem
                      key={session.sessionId}
                      session={session}
                      isActive={currentChatSession?.sessionId === session.sessionId}
                      onClick={() => selectChatSession(session)}
                      onDelete={(e) => {
                        e.stopPropagation()
                        deleteChatSession(session.sessionId)
                      }}
                      onEdit={(e) => {
                        e.stopPropagation()
                        setEditingSessionId(session.sessionId)
                        setEditingTitle(session.title)
                      }}
                      onPin={(e) => {
                        e.stopPropagation()
                        togglePinSession(session.sessionId, e)
                      }}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          )}
          
          {/* Collapsed Sidebar - Show Recent Sessions as Icons */}
          {sidebarCollapsed && (
            <ScrollArea className="flex-1 relative">
              <div className="p-2 space-y-2 flex flex-col items-center">
                {chatSessions.slice(0, 5).map((session) => (
                  <Button
                    key={session.sessionId}
                    variant="ghost"
                    size="icon"
                    onClick={() => selectChatSession(session)}
                    className={`h-10 w-10 rounded-lg transition-all duration-200 relative group ${
                      currentChatSession?.sessionId === session.sessionId
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        : 'hover:bg-muted/50 dark:hover:bg-gray-800 text-muted-foreground dark:text-gray-400'
                    }`}
                    title={session.title}
                  >
                    <MessageCircle className="h-5 w-5" />
                    {currentChatSession?.sessionId === session.sessionId && (
                      <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-6 bg-blue-500 rounded-r-full" />
                    )}
                  </Button>
                ))}
                {chatSessions.length > 5 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSidebarCollapsed(false)}
                    className="h-8 w-8 rounded-lg text-gray-400 hover:text-muted-foreground dark:hover:text-gray-300 hover:bg-muted/50 dark:hover:bg-gray-800 mt-2"
                    title={`+${chatSessions.length - 5} more chats`}
                  >
                    <span className="text-xs font-bold">+{chatSessions.length - 5}</span>
                  </Button>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Enhanced Mobile-First Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 relative h-full">
                    {/* Mobile-Optimized Header */}
          <div className="lg:hidden bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-700/50 p-3 relative">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(true)}
                className="h-8 w-8 hover:bg-muted/50 dark:hover:bg-gray-800 rounded-lg"
              >
                <Menu className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <h1 className="text-base font-bold text-foreground dark:text-gray-100">
                  {currentChatSession?.title || 'SMART HR Assistant'}
                </h1>
              </div>
            </div>
          </div>
          
          {/* Desktop Collapsed Sidebar Toggle */}
          {sidebarCollapsed && (
            <div className="hidden lg:block fixed top-20 left-4 z-30">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarCollapsed(false)}
                className="h-10 w-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 hover:bg-muted/50 dark:hover:bg-gray-800 rounded-lg shadow-lg"
                title="Expand Sidebar"
              >
                <Menu className="h-5 w-5 text-muted-foreground dark:text-gray-400" />
              </Button>
            </div>
          )}

          {/* Messages */}
          <ScrollArea className="flex-1 p-2 sm:p-3 lg:p-4 xl:p-6 chat-messages relative" style={{ pointerEvents: 'auto' }}>
            {/* Background pattern */}
            <div className="absolute inset-0 opacity-[0.02] dark:opacity-[0.05] pointer-events-none">
              <div className="w-full h-full pointer-events-none" style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Ccircle cx='30' cy='30' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
              }} />
            </div>
            
            <div className="space-y-6 relative z-10">
              {messages.map((message) => (
                <div key={message.id} className={`flex message-container ${message.type === "user" ? "justify-end" : "justify-start"} ${message.isJobForm ? 'px-8' : 'max-w-4xl mx-auto'}`}>
                  <div
                    className={`flex ${message.isJobForm ? 'w-[80%] mx-auto' : 'max-w-[95%] sm:max-w-[90%] lg:max-w-[85%]'} gap-2 sm:gap-3 lg:gap-4 rounded-2xl p-3 sm:p-4 lg:p-5 message-bubble group transition-all duration-300 hover:shadow-xl relative ${
                      message.type === "user"
                        ? "bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 text-white shadow-lg"
                        : "bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 shadow-lg"
                    }`}
                    style={{ pointerEvents: 'auto' }}
                  >
                    {message.type === "assistant" && (
                      <Avatar className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 flex-shrink-0 ring-2 ring-gray-200 dark:ring-gray-700">
                        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs">
                          <Bot className="h-3 w-3 sm:h-3.5 sm:w-3.5 lg:h-4 lg:w-4" />
                        </AvatarFallback>
                      </Avatar>
                    )}
                    
                    <div className="flex-1 space-y-3 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className={`text-sm font-semibold ${message.type === "user" ? "text-white/90" : "text-foreground dark:text-gray-100"}`}>
                          {message.type === "user" ? "You" : "AI Assistant"}
                        </p>
                        <div className="flex items-center gap-2">
                          <p className={`text-xs ${message.type === "user" ? "text-white/70" : "text-muted-foreground dark:text-gray-400"}`}>
                            {formatTimestamp(message.timestamp)}
                          </p>
                          {message.type === "assistant" && !message.isLoading && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted/50 dark:hover:bg-gray-700"
                              onClick={() => copyMessage(message.content)}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      
                      {message.isLoading ? (
                        <div className="space-y-3">
                          {/* Show streaming content if available */}
                          {message.content && (
                            <div className="text-sm leading-relaxed text-foreground dark:text-gray-300 mb-4">
                              <MessageRenderer 
                                content={message.content} 
                                isUser={false}
                                onActionClick={handleActionClick}
                              />
                              {/* Blinking cursor to indicate streaming */}
                              <span className="inline-block w-2 h-5 ml-1 bg-blue-500 animate-pulse rounded-sm"></span>
                            </div>
                          )}
                          
                          {/* Enhanced loading indicator with real-time streaming */}
                          {!message.content && (
                            <div className="flex items-center gap-3">
                              <div className="relative">
                                <div className="w-4 h-4 bg-blue-500 rounded-full animate-pulse"></div>
                                <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-50"></div>
                              </div>
                              <span className="text-sm text-muted-foreground dark:text-gray-400 font-medium">
                                {isProcessing ? 'Processing your request...' : 'AI is thinking...'}
                              </span>
                            </div>
                          )}
                          
                          {/* ThinkingProcess component positioned inside the message bubble */}
                          <ThinkingProcess 
                            thinkingMessages={thinkingMessages}
                            isProcessing={isProcessing}
                            className="mt-4"
                          />
                          
                          {/* Show real-time streaming status */}
                          {thinkingMessages.length > 0 && (
                            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                                  Live Processing ({thinkingMessages.length} steps)
                                </span>
                              </div>
                              
                              {/* Show the latest thinking step */}
                              {thinkingMessages.length > 0 && (
                                <div className="text-xs text-blue-600 dark:text-blue-400">
                                  Latest: {thinkingMessages[thinkingMessages.length - 1]?.status || 'Processing...'}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          {/* REMOVED: Job Form Rendering - AI Assistant no longer creates jobs */}
                          {message.isJobForm ? (
                            <div className="w-full p-6 text-center bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                              <p className="text-foreground dark:text-gray-300">
                                ℹ️ Job creation form has been removed. Please use the Jobs page to create new jobs.
                              </p>
                            </div>
                          ) : message.guideData ? (
                            <div className="text-sm leading-relaxed">
                              <GuideRenderer guide={message.guideData as any} />
                            </div>
                          ) : (
                            <div className={`text-sm leading-relaxed ${message.type === "user" ? "text-white/95" : "text-foreground dark:text-gray-300"}`}>
                              <MessageRenderer 
                                content={message.content} 
                                isUser={message.type === "user"}
                                onActionClick={handleActionClick}
                              />
                            </div>
                          )}
                          
                          {/* Actions */}
                          {message.actions && message.actions.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-2 action-buttons">
                              {message.actions.map((action, index) => (
                                <Button
                                  key={index}
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleActionClick(action.action, action.data)}
                                  className="action-button bg-white/50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700 backdrop-blur-sm transition-all duration-200 hover:shadow-md rounded-lg sm:rounded-xl"
                                >
                                  {action.icon === "briefcase" && <Briefcase className="mr-2 h-3 w-3" />}
                                  {action.icon === "users" && <Users className="mr-2 h-3 w-3" />}
                                  {action.icon === "upload" && <Paperclip className="mr-2 h-3 w-3" />}
                                  {action.icon === "bar-chart" && <BarChart3 className="mr-2 h-3 w-3" />}
                                  {action.icon === "external-link" && <ExternalLink className="mr-2 h-3 w-3" />}
                                  {action.icon === "calendar" && <Clock className="mr-2 h-3 w-3" />}
                                  {action.icon === "plus" && <Plus className="mr-2 h-3 w-3" />}
                                  {action.icon === "check" && <CheckCircle className="mr-2 h-3 w-3" />}
                                  {action.label}
                                </Button>
                              ))}
                            </div>
                          )}
                          
                          {/* Metadata */}
                          {message.metadata && (
                            <div className="message-metadata flex items-center gap-4 pt-2 text-xs">
                              {message.metadata.confidence && (
                                <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full transition-all duration-300 ${
                                    isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                                  }`}></div>
                                  <span className="text-xs font-medium text-muted-foreground dark:text-gray-400">
                                    Confidence: {Math.round(message.metadata.confidence * 100)}%
                                  </span>
                                  <div className="w-16 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-500" 
                                      style={{ width: `${message.metadata.confidence * 100}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                               {/* Display agent steps if they exist */}
                              {message.metadata.agentSteps && message.metadata.agentSteps.length > 0 && (
                                <details className="text-muted-foreground dark:text-gray-400">
                                  <summary className="cursor-pointer hover:underline">Agent Activity</summary>
                                  <ul className="list-disc list-inside pl-4 mt-1 text-xs">
                                    {message.metadata.agentSteps.map((step, idx) => (
                                      <li key={idx}>{typeof step === 'string' ? step : JSON.stringify(step)}</li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                                    </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input Area */}
          <div className="border-t bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border-gray-200/50 dark:border-gray-700/50 p-3 input-container flex-shrink-0 z-20 shadow-[0_-5px_15px_-5px_rgba(0,0,0,0.05)] dark:shadow-[0_-5px_15px_-5px_rgba(0,0,0,0.2)]">
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-blue-50/10 via-transparent to-transparent dark:from-blue-950/10 dark:via-transparent dark:to-transparent pointer-events-none" />
            
            <div className="max-w-4xl mx-auto relative">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileSelect}
                className="hidden"
              />
              
              {/* REMOVED: Quick Actions - Keep the interface clean and focused */}
              {false && messages.length <= 1 && (
                <div className="mb-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground dark:text-gray-100">Quick Actions</h3>
                      <p className="text-sm text-muted-foreground dark:text-gray-400">Get started with these common tasks</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {suggestedPrompts.map((prompt, index) => (
                      <Card
                        key={index}
                        className="group cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/10 hover:-translate-y-1 border-0 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm"
                        onClick={() => handleSuggestedPrompt(prompt)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${prompt.gradient} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                              {React.cloneElement(prompt.icon, { className: "text-white h-4 w-4" })}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-foreground dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-300 text-sm">
                                {prompt.text}
                              </h4>
                              <p className="text-xs text-muted-foreground dark:text-gray-400 mt-1">
                                {prompt.followUp}
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all duration-300" />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Modern Input Interface */}
              <div className="relative">
                <div className="flex items-center gap-3 p-3 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300">
                  {/* Connection Status Indicator */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className={`relative w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                      isConnected 
                        ? 'bg-gradient-to-r from-green-400 to-emerald-500 shadow-lg shadow-green-400/50' 
                        : 'bg-gradient-to-r from-red-400 to-pink-500 shadow-lg shadow-red-400/50'
                    }`}>
                      {isConnected && (
                        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 animate-ping opacity-75" />
                      )}
                    </div>
                    <span className={`text-xs font-medium transition-colors duration-300 hidden sm:inline ${
                      isConnected 
                        ? 'text-green-600 dark:text-green-400' 
                        : 'text-red-600 dark:text-red-400'
                    }`}>
                      {isConnected ? 'Online' : 'Offline'}
                    </span>
                  </div>

                  {/* Enhanced Textarea */}
                  <div className="flex-1 relative">
                    <Textarea
                      placeholder="Ask me anything about HR, candidates, jobs, or upload a document..."
                      ref={textareaRef}
                      rows={1}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      className="flex-1 min-h-10 max-h-24 resize-none bg-transparent border-0 focus:ring-0 focus-visible:ring-0 px-0 py-2 placeholder:text-gray-400 dark:placeholder:text-muted-foreground text-foreground dark:text-gray-100 text-sm leading-relaxed"
                      disabled={isAssistantTyping || isFileParsing}
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* REMOVED: Job Creation Button - AI Assistant no longer creates jobs directly */}

                    {/* File Upload Button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={triggerFileInput}
                      disabled={isAssistantTyping || isProcessing || !isConnected || isFileParsing}
                      className="h-10 w-10 rounded-lg text-muted-foreground hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-300"
                      title="Attach PDF or Word document"
                    >
                      {isFileParsing ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                    </Button>
                    
                    {/* Send Button */}
                    <Button
                      size="icon"
                      onClick={handleSendMessage}
                      disabled={inputValue.trim() === "" || isAssistantTyping || isProcessing || !isConnected || isFileParsing}
                      className="h-10 w-10 bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-600 hover:from-blue-600 hover:via-purple-600 hover:to-indigo-700 shadow-lg hover:shadow-xl hover:shadow-blue-500/30 transition-all duration-300 rounded-lg border-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isAssistantTyping || isProcessing ? (
                        <Loader2 className="h-4 w-4 animate-spin text-white" />
                      ) : (
                        <Send className="h-4 w-4 text-white" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
