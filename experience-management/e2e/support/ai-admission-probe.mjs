const [operation, spaceId, userId, requestKey] = process.argv.slice(2);

if (!['direct', 'durable'].includes(operation) || !spaceId || !userId || !requestKey) {
  process.stderr.write('Usage: ai-admission-probe.mjs <direct|durable> <spaceId> <userId> <requestKey>\n');
  process.exit(2);
}

const [{ createAdmittedAiJob }, { db }, { consumeDirectAiAction }] = await Promise.all([
  import('../../backend/dist/aiJobAdmission.js'),
  import('../../backend/dist/database.js'),
  import('../../backend/dist/subscriptionEntitlements.js')
]);

process.stdout.write(`${JSON.stringify({ ready: true, operation })}\n`);
process.stdin.setEncoding('utf8');
let input = '';
let started = false;

async function run() {
  if (started) return;
  started = true;
  try {
    if (operation === 'direct') {
      const receipt = consumeDirectAiAction({
        spaceId, userId, actionId: 'knowledge.answer', requestKey
      });
      process.stdout.write(`${JSON.stringify({ ok: true, operation, receipt })}\n`);
    } else {
      const job = createAdmittedAiJob('social.analyze', { mentionIds: [] }, spaceId, null, null, userId);
      process.stdout.write(`${JSON.stringify({ ok: true, operation, jobId: job.id })}\n`);
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      operation,
      name: error instanceof Error ? error.name : 'Error',
      code: error && typeof error === 'object' && 'code' in error ? String(error.code) : null,
      status: error && typeof error === 'object' && 'status' in error ? Number(error.status) : null
    })}\n`);
  } finally {
    db.close();
    process.stdin.destroy();
  }
}

process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.includes('\n') && input.trim() === 'GO') void run();
});
