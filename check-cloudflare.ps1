# Check Cloudflare Domains Script
$token = "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
$headers = @{
    "Authorization" = "Bearer $token"
}

try {
    $response = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones" `
        -Headers $headers `
        -Method GET `
        -ContentType "application/json"
    
    $zones = $response.result
    
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Cloudflare Domains/ Zones" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    
    if ($zones.Count -eq 0) {
        Write-Host "No zones/domains found." -ForegroundColor Yellow
    } else {
        $zones | ForEach-Object {
            Write-Host "Domain: $($_.name)" -ForegroundColor Green
            Write-Host "  Zone ID: $($_.id)" -ForegroundColor White
            Write-Host "  Status: $($_.status)" -ForegroundColor White
            Write-Host "  Account ID: $($_.account.id)" -ForegroundColor White
            Write-Host "  Plan: $($_.plan.name)" -ForegroundColor Gray
            Write-Host "  Nameservers:" -ForegroundColor Gray
            $_.name_servers | ForEach-Object {
                Write-Host "    - $_" -ForegroundColor DarkGray
            }
            Write-Host ""
        }
        
        Write-Host "Total zones: $($zones.Count)" -ForegroundColor Cyan
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Make sure your API token has 'Zone:Read' permissions" -ForegroundColor Yellow
}
