const ws = require('../services/weaviateService');

(async () => {
  try {
    const result = await ws.client.graphql
      .get()
      .withClassName('Candidate')
      .withFields('candidateId organizationId firstName lastName')
      .withLimit(10)
      .do();

    const candidates = result.data?.Get?.Candidate || [];
    console.log(`Found ${candidates.length} candidates in Weaviate:`);
    candidates.forEach(c => {
      console.log(`  ${c.firstName} ${c.lastName} | orgId: "${c.organizationId}" | candidateId: ${c.candidateId}`);
    });

    // Also try without org filter
    const embedding = require('../services/embeddingService');
    const queryEmb = await embedding.generateEmbedding('Product Manager fintech banking');
    const searchResult = await ws.searchSimilarCandidates(queryEmb, null, 3);
    console.log(`\nSearch WITHOUT org filter: ${searchResult.length} results`);
    searchResult.forEach(c => {
      console.log(`  ${c.firstName} ${c.lastName} | orgId: "${c.organizationId}" | dist: ${c._additional?.distance}`);
    });
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();
