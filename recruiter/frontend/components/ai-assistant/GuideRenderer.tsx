"use client"

import React from 'react'
import Link from 'next/link'
import { GuideCard } from './GuideCard'
import { TutorialSteps } from './TutorialSteps'
import { ArrowRight, Sparkles } from 'lucide-react'

interface GuideResponse {
  type: string
  intent: string
  title: string
  introduction: string
  steps: Array<{
    number: number
    title: string
    description: string
    tip?: string
  }>
  navigationCard: {
    title: string
    description: string
    primaryButton: {
      label: string
      url: string
      icon: string
    }
    secondaryButton?: {
      label: string
      url: string
      icon: string
    }
  }
  tips?: string[]
  relatedFeatures?: Array<{
    name: string
    url: string
    description: string
  }>
  commonTopics?: Array<{
    title: string
    examples: string[]
  }>
}

interface GuideRendererProps {
  guide: GuideResponse
}

export function GuideRenderer({ guide }: GuideRendererProps) {
  return (
    <div className="space-y-5 max-w-3xl">
      {/* Title */}
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {guide.title}
      </h2>
      
      {/* Introduction */}
      <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
        {guide.introduction}
      </p>
      
      {/* Tutorial Steps */}
      <TutorialSteps steps={guide.steps} />
      
      {/* Navigation Card */}
      <GuideCard {...guide.navigationCard} />
      
      {/* Pro Tips Section */}
      {guide.tips && guide.tips.length > 0 && (
        <div className="bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-900/20 dark:to-amber-900/20 border-l-4 border-yellow-400 p-4 rounded-r-lg">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <h4 className="font-semibold text-gray-900 dark:text-gray-100">
              💡 Pro Tips:
            </h4>
          </div>
          <ul className="space-y-2">
            {guide.tips.map((tip, index) => (
              <li key={index} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-2">
                <span className="text-yellow-600 dark:text-yellow-400 font-bold">•</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Related Features */}
      {guide.relatedFeatures && guide.relatedFeatures.length > 0 && (
        <div className="pt-2">
          <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
            🔗 Related Features:
          </h4>
          <div className="space-y-2">
            {guide.relatedFeatures.map((feature, index) => (
              <Link 
                key={index} 
                href={feature.url}
                className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-all group"
              >
                <ArrowRight className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5 group-hover:translate-x-1 transition-transform" />
                <div className="flex-1">
                  <div className="font-medium text-blue-600 dark:text-blue-400 group-hover:underline">
                    {feature.name}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {feature.description}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
      
      {/* Common Topics (for welcome guide) */}
      {guide.commonTopics && guide.commonTopics.length > 0 && (
        <div className="pt-2">
          <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
            💬 Try asking me:
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {guide.commonTopics.map((topic, index) => (
              <div key={index} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <h5 className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-2">
                  {topic.title}
                </h5>
                <ul className="space-y-1">
                  {topic.examples.map((example, i) => (
                    <li key={i} className="text-xs text-gray-600 dark:text-gray-400">
                      • "{example}"
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

