/**
 * Historical one-off: copied vectors from Pinecone into Weaviate.
 * The Pinecone SDK has been removed from this project — run an older git revision if you still need this.
 */
console.error(
  'migratePineconeToWeaviate is retired (Pinecone SDK removed). Vectors are stored only in Weaviate.'
);
console.error('To migrate legacy Pinecone data, checkout a pre-removal commit and run with PINECONE_API_KEY set.');
process.exit(1);
