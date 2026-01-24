# tool-pick-test.ps1
# Simple smoke test for the Master Orchestrator tool-pick logic.
# Run: .\.cursor\scripts\orchestrator\tool-pick-test.ps1

Write-Host "=== Master Orchestrator Tool-Pick Smoke Test ==="
Write-Host ""

$knownTools = @(
    'deploy-agent', 'deploy-server', 'web-research', 'web-search-prime', 'web-reader', 'Context7',
    'dev-subagent', 'tea-subagent', 'architect-subagent', 'pm-subagent', 'analyst-subagent',
    'tech-writer-subagent', 'tech-writer', 'quick-flow-solo-dev-subagent', 'sm-subagent',
    'bmad-master', 'create-rule', 'create-skill', 'create-bmad-skills', 'party-mode-subagent',
    'sequential-thinking', 'cursor-ide-browser', 'Notion'
)

Write-Host "Known orchestrator tools/subagents/skills/MCP:"
foreach ($t in $knownTools) {
    Write-Host "  - $t"
}
Write-Host ""

# A few representative test cases from test-matrix.md
$cases = @(
    @{ Id = 1; Task = "Deploy the approver app to dev"; Expect = "deploy-agent or deploy-server" },
    @{ Id = 2; Task = "Search the web for Next.js 15 features"; Expect = "web-research or web-search-prime" },
    @{ Id = 3; Task = "How does Supabase auth work? Build a small example"; Expect = "Context7 → dev-subagent" },
    @{ Id = 5; Task = "Add the export button, run tests, and deploy"; Expect = "dev-subagent → tea-subagent → deploy-agent" },
    @{ Id = 7; Task = "Search Notion for 'auth design' and add a summary page"; Expect = "Notion → tech-writer/analyst → Notion" },
    @{ Id = 8; Task = "Should we use microservices or monolith?"; Expect = "sequential-thinking → web-research → architect-subagent" },
    @{ Id = 15; Task = "Full cycle: new auth feature from requirements to deploy"; Expect = "web-research → pm-subagent → architect-subagent → dev-subagent → tea-subagent → deploy-agent" }
)

Write-Host "Test cases (task → expected tools):"
foreach ($c in $cases) {
    Write-Host ("  [{0}] {1}  =>  {2}" -f $c.Id, $c.Task, $c.Expect)
}

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1) Open .cursor/scripts/orchestrator/test-matrix.md for the full set of cases."
Write-Host "  2) In Cursor chat, run /master-orchestrator with any of these tasks."
Write-Host "  3) Verify that the tools it actually uses match the 'Expected' column."
Write-Host ""
Write-Host "tool-pick-test.ps1 completed."
exit 0
