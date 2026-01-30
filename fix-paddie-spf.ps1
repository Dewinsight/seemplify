# Fix paddie.io SPF: remove mail.seemplifyai.com (Mailcow), keep Microsoft + Brevo
$token = "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
$zoneId = "89215efb800fcc1bdc2cb1ca528eae59"
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

$response = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" -Headers $headers -Method GET
$spfRecord = $response.result | Where-Object { $_.type -eq "TXT" -and $_.name -eq "paddie.io" -and $_.content -like "*v=spf1*" } | Select-Object -First 1

if (-not $spfRecord) {
    Write-Host "SPF TXT record not found." -ForegroundColor Red
    exit 1
}

$newContent = "v=spf1 include:spf.protection.outlook.com include:spf.brevo.com ~all"
$body = @{ type = "TXT"; name = "paddie.io"; content = $newContent; ttl = 1 } | ConvertTo-Json

$updateResponse = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records/$($spfRecord.id)" -Headers $headers -Method PUT -Body $body

if ($updateResponse.success) {
    Write-Host "SPF updated. New value: $newContent" -ForegroundColor Green
} else {
    Write-Host "Update failed: $($updateResponse.errors)" -ForegroundColor Red
    exit 1
}
