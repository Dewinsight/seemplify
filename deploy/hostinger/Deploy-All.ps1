[CmdletBinding()]
param(
    [string]$SeemplifyRef = 'main',
    [string]$WorkspaceRef = 'main',
    [switch]$SkipWorkspace,
    [switch]$SkipMilo
)

$ErrorActionPreference = 'Stop'

function Invoke-Gh {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $output = & gh @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "gh $($Arguments -join ' ') failed:`n$($output -join [Environment]::NewLine)"
    }
    return @($output)
}

function Invoke-DeploymentWorkflow {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string]$Workflow,
        [Parameter(Mandatory = $true)][string]$Ref
    )

    Write-Host "Dispatching $Repository / $Workflow at $Ref"
    $dispatchOutput = Invoke-Gh workflow run $Workflow --repo $Repository --ref $Ref
    $runUrl = $dispatchOutput | Where-Object { $_ -match 'https://github\.com/.+/actions/runs/\d+' } | Select-Object -Last 1

    if (-not $runUrl) {
        throw "GitHub CLI did not return a run URL for $Repository / $Workflow."
    }

    $runId = [regex]::Match($runUrl, '/runs/(\d+)').Groups[1].Value
    Write-Host "Waiting for $runUrl"
    & gh run watch $runId --repo $Repository --exit-status
    if ($LASTEXITCODE -ne 0) {
        throw "$Repository / $Workflow failed: $runUrl"
    }
}

Invoke-Gh auth status | Out-Null

$seemplifyRepository = 'Dewinsight/seemplify'
$workspaceRepository = 'Dewinsight/experienments2'
$seemplifyWorkflows = @(
    'provision-experience-knowledge-hostinger.yml',
    'deploy-core-hostinger.yml',
    'deploy-experience-hostinger.yml',
    'deploy-approver-hostinger.yml',
    'deploy-chatgpt-gateway-hostinger.yml',
    'deploy-connectors-hostinger.yml',
    'deploy-mail-service.yml',
    'deploy-coturn-hostinger.yml',
    'deploy-lms-hostinger.yml'
)

foreach ($workflow in $seemplifyWorkflows) {
    Invoke-DeploymentWorkflow -Repository $seemplifyRepository -Workflow $workflow -Ref $SeemplifyRef
}

if (-not $SkipWorkspace) {
    if ($WorkspaceRef -ne 'main') { throw 'Workspace production requires main' }
    $variables = (Invoke-Gh api "repos/$workspaceRepository/actions/variables") -join "`n" | ConvertFrom-Json
    $driver = $variables.variables | Where-Object name -eq HOSTINGER_CI_DRIVER | Select-Object -ExpandProperty value
    if ($driver -eq 'local') {
        $sha = (Invoke-Gh api "repos/$workspaceRepository/git/ref/heads/main" --jq .object.sha | Select-Object -First 1).Trim()
        $requestedAt = [DateTimeOffset]::UtcNow
        $nonce = 'release-' + [Guid]::NewGuid().ToString('N')
        Invoke-Gh variable set HOSTINGER_CI_REQUEST --repo $workspaceRepository --body $nonce | Out-Null
        $deadline = $requestedAt.AddHours(4)
        do {
            Start-Sleep -Seconds 15
            $statuses = (Invoke-Gh api "repos/$workspaceRepository/commits/$sha/statuses") -join "`n" | ConvertFrom-Json
            $status = $statuses | Where-Object {
                $_.context -eq 'hostinger-ci/workspace-production' -and
                [DateTimeOffset]::Parse($_.created_at) -ge $requestedAt.AddSeconds(-1)
            } | Select-Object -First 1
            if ($status.state -eq 'success') { break }
            if ($status.state -in @('failure','error')) { throw 'Workspace KVM4 deployment failed; inspect its private host log' }
        } while ([DateTimeOffset]::UtcNow -lt $deadline)
        if ($status.state -ne 'success') { throw 'Timed out waiting for Workspace KVM4 deployment' }
    } else {
        Invoke-DeploymentWorkflow -Repository $workspaceRepository -Workflow 'deploy-hostinger.yml' -Ref $WorkspaceRef
    }
}

if (-not $SkipMilo) {
    Invoke-DeploymentWorkflow -Repository 'michaelegbo/milo' -Workflow 'ci.yml' -Ref main
}

Write-Host 'All requested Hostinger deployment workflows completed successfully.'
