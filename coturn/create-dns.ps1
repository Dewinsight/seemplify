$token = "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
$zoneId = "bbc142d2d661d64011e2e4becae7a5c3"
$body = '{"type":"A","name":"turn","content":"4.180.153.209","ttl":3600,"proxied":false}'
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}
$uri = "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records"
try {
    $r = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body
    Write-Host "SUCCESS"; Write-Host $r.result.id
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 409) { Write-Host "EXISTS" } else { Write-Host "ERROR: $_"; exit 1 }
}
