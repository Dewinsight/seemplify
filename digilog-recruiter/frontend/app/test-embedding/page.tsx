'use client'

import { useState } from 'react'
import { embeddingService } from '@/services/embeddingService'

export default function TestEmbeddingPage() {
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string>('')
  
  const testEmbedding = async () => {
    try {
      setError('')
      setResult(null)
      
      // Log the environment variable
      console.log('NEXT_PUBLIC_API_URL:', process.env.NEXT_PUBLIC_API_URL)
      
      const candidateId = '6845ab1b6db084f0142f69f9'
      
      // Test the embedding status
      const status = await embeddingService.checkEmbeddingStatus(candidateId)
      setResult(status)
    } catch (err: any) {
      console.error('Test error:', err)
      setError(err.message)
    }
  }
  
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Embedding Service Test</h1>
      
      <div className="mb-4">
        <p><strong>Environment:</strong> {process.env.NEXT_PUBLIC_API_URL || 'Not set (using default)'}</p>
      </div>
      
      <button 
        onClick={testEmbedding}
        className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
      >
        Test Embedding Status
      </button>
      
      {result && (
        <div className="mt-4 p-4 bg-green-100 rounded">
          <h2 className="font-bold">Success!</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
      
      {error && (
        <div className="mt-4 p-4 bg-red-100 rounded">
          <h2 className="font-bold">Error:</h2>
          <p>{error}</p>
        </div>
      )}
      
      <div className="mt-8">
        <h2 className="font-bold mb-2">Check Console for:</h2>
        <ul className="list-disc ml-6">
          <li>Environment variable value</li>
          <li>Actual URL being called</li>
          <li>Any error details</li>
        </ul>
      </div>
    </div>
  )
} 