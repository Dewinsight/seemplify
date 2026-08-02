"use client"

import React from 'react'
import { CheckCircle, Lightbulb } from 'lucide-react'

interface Step {
  number: number
  title: string
  description: string
  tip?: string
}

interface TutorialStepsProps {
  steps: Step[]
}

export function TutorialSteps({ steps }: TutorialStepsProps) {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
        <CheckCircle className="h-5 w-5 text-green-600" />
        Step-by-Step Guide:
      </h3>
      
      <ol className="space-y-4">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-3 group">
            {/* Step Number Circle */}
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[#754BE5] to-[#6935CF] text-white flex items-center justify-center text-sm font-bold shadow-md group-hover:scale-110 transition-transform">
              {step.number}
            </div>
            
            {/* Step Content */}
            <div className="flex-1 space-y-1">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100">
                {step.title}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {step.description}
              </p>
              
              {/* Tip */}
              {step.tip && (
                <div className="flex items-start gap-2 mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border-l-2 border-yellow-400 rounded">
                  <Lightbulb className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-800 dark:text-yellow-300">
                    <span className="font-semibold">Tip:</span> {step.tip}
                  </p>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

