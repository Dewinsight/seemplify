[CmdletBinding()]
param(
    [string]$SeemplifyRef = 'main',
    [string]$WorkspaceRef = 'main',
    [switch]$SkipWorkspace
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
    'deploy-automation-hostinger.yml',
    'deploy-mail-service.yml',
    'deploy-coturn-hostinger.yml'
)

foreach ($workflow in $seemplifyWorkflows) {
    Invoke-DeploymentWorkflow -Repository $seemplifyRepository -Workflow $workflow -Ref $SeemplifyRef
}

if (-not $SkipWorkspace) {
    Invoke-DeploymentWorkflow -Repository $workspaceRepository -Workflow 'deploy-hostinger.yml' -Ref $WorkspaceRef
}

Write-Host 'All requested Hostinger deployment workflows completed successfully.'
