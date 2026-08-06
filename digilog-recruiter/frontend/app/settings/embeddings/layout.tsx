import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Embedding Management - SmartHR',
  description: 'Manage and monitor AI embeddings for enhanced candidate matching',
};

export default function EmbeddingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
} 