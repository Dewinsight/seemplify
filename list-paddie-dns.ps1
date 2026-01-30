# List paddie.io DNS records from Cloudflare
$token = "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
$zoneId = "89215efb800fcc1bdc2cb1ca528eae59"
$headers = @{
    "Authorization" = "Bearer $token"
}
$response = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" -Headers $headers -Method GET
$response.result | ForEach-Object { "$($_.type)  $($_.name)  ->  $($_.content)" }
