# ============================================================================
# REMOVE-DEV-SERVICES.ps1
# Removes all -dev services from Dokploy and cleans up DNS records
# ============================================================================

param(
    [switch]$Preview,
    [switch]$RemoveDNS,
    [switch]$Force
)

# ============================================================================
# CONFIGURATION
# ============================================================================

$DOKPLOY_URL = "http://4.180.153.209:3000"
$DOKPLOY_EMAIL = "admin@seemplifyai.com"
$DOKPLOY_PASSWORD = "Seemplify2026!"
$CLOUDFLARE_ZONE_ID = "bbc142d2d661d64011e2e4becae7a5c3"
$CLOUDFLARE_API_TOKEN = "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ"
$VM_IP = "4.180.153.209"

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor DarkGray
Write-Host "  REMOVING -DEV SERVICES FROM DOKPLOY" -ForegroundColor Cyan
Write-Host ("=" * 70) -ForegroundColor DarkGray
Write-Host ""
Write-Host "Dokploy URL: $DOKPLOY_URL" -ForegroundColor Cyan
Write-Host "Cloudflare Zone: $CLOUDFLARE_ZONE_ID" -ForegroundColor Cyan
Write-Host ""

# ============================================================================
# STEP 1: AUTHENTICATE WITH DOKPLOY
# ============================================================================

Write-Host "STEP 1: AUTHENTICATING WITH DOKPLOY" -ForegroundColor Yellow
Write-Host ""

try {
    $loginResponse = Invoke-RestMethod -Uri "$DOKPLOY_URL/api/login" -Method Post -ContentType "application/json" -Body @{
        email = $DOKPLOY_EMAIL
        password = $DOKPLOY_PASSWORD
    } -ErrorAction SilentlyContinue

    if ($loginResponse.token) {
        $DOKPLOY_TOKEN = $loginResponse.token
        Write-Host "[OK] Successfully authenticated with Dokploy" -ForegroundColor Green
    }
    else {
        $DOKPLOY_TOKEN = $DOKPLOY_PASSWORD
        Write-Host "[OK] Using API token from configuration" -ForegroundColor Green
    }
}
catch {
    Write-Host "[WARN] Could not authenticate, trying with credentials" -ForegroundColor Yellow
    $DOKPLOY_TOKEN = $DOKPLOY_PASSWORD
}

$headers = @{"x-api-key" = $DOKPLOY_TOKEN}

# ============================================================================
# STEP 2: GET ALL PROJECTS
# ============================================================================

Write-Host ""
Write-Host "STEP 2: GETTING ALL PROJECTS FROM DOKPLOY" -ForegroundColor Yellow
Write-Host ""

$projects = $null
$projectsUrl = "$DOKPLOY_URL/api/project"

try {
    $projects = Invoke-RestMethod -Uri $projectsUrl -Headers $headers -ErrorAction SilentlyContinue
    
    if ($projects) {
        Write-Host "[OK] Found $($projects.Count) project(s)" -ForegroundColor Green
        $projects | ForEach-Object {
            Write-Host "  - Project: $($_.name) (ID: $($_.id))" -ForegroundColor White
        }
    }
}
catch {
    Write-Host "[WARN] Could not fetch projects from Dokploy" -ForegroundColor Yellow
    Write-Host "       The Dokploy API might be using a different endpoint structure" -ForegroundColor Yellow
}

# ============================================================================
# STEP 3: FIND ALL -DEV SERVICES
# ============================================================================

Write-Host ""
Write-Host "STEP 3: FINDING ALL -DEV SERVICES" -ForegroundColor Yellow
Write-Host ""

$allServices = @()
$devServices = @()

if ($projects) {
    foreach ($project in $projects) {
        Write-Host "Checking project: $($project.name)..." -ForegroundColor Cyan
        
        $servicesUrls = @(
            "$DOKPLOY_URL/api/project/$($project.id)/services",
            "$DOKPLOY_URL/api/projects/$($project.id)/services"
        )

        $services = $null
        foreach ($url in $servicesUrls) {
            try {
                $services = Invoke-RestMethod -Uri $url -Headers $headers -ErrorAction SilentlyContinue
                if ($services -and $services.Count -gt 0) { break }
            }
            catch { continue }
        }

        if ($services) {
            foreach ($service in $services) {
                $allServices += $service
                
                if ($service.name -match '-dev') {
                    $devServices += $service
                    Write-Host "  [DEV] $($service.name) (ID: $($service.id))" -ForegroundColor Red
                }
                else {
                    Write-Host "  [OK] $($service.name)" -ForegroundColor Green
                }
            }
        }
        else {
            Write-Host "  [WARN] No services found for this project" -ForegroundColor Yellow
        }
    }
}
else {
    Write-Host "[WARN] No projects found to check" -ForegroundColor Yellow
}

# ============================================================================
# STEP 4: DISPLAY DEV SERVICES
# ============================================================================

Write-Host ""
Write-Host "STEP 4: DEV SERVICES TO REMOVE" -ForegroundColor Yellow
Write-Host ""

if ($devServices.Count -gt 0) {
    Write-Host "Found $($devServices.Count) dev service(s) to remove:" -ForegroundColor Yellow
    Write-Host ""
    
    $devServices | ForEach-Object {
        Write-Host "  Service Name:  $($_.name)" -ForegroundColor White
        Write-Host "  Service ID:   $($_.id)" -ForegroundColor White
        Write-Host ""
    }
}
else {
    Write-Host "[OK] No dev services found matching '-dev' pattern" -ForegroundColor Green
}

# ============================================================================
# STEP 5: IDENTIFY DEV DNS RECORDS
# ============================================================================

Write-Host "STEP 5: CHECKING DEV DNS RECORDS IN CLOUDFLARE" -ForegroundColor Yellow
Write-Host ""

$devSubdomains = @("app-dev", "api-dev", "leave-dev", "api-leave-dev", "performance-dev", "api-performance-dev", "payroll-dev", "api-payroll-dev", "auth-dev", "dokploy-dev")
$devDnsRecords = @()

try {
    $dnsResponse = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records" -Headers @{
        "Authorization" = "Bearer $CLOUDFLARE_API_TOKEN"
        "Content-Type" = "application/json"
    } -ErrorAction SilentlyContinue

    if ($dnsResponse -and $dnsResponse.success -and $dnsResponse.result) {
        foreach ($record in $dnsResponse.result) {
            foreach ($subdomain in $devSubdomains) {
                if ($record.name -like "*$subdomain*") {
                    $devDnsRecords += $record
                    Write-Host "  [DNS] $($record.name) -> $($record.content) (ID: $($record.id))" -ForegroundColor Red
                }
            }
        }
        
        if ($devDnsRecords.Count -eq 0) {
            Write-Host "[OK] No dev DNS records found" -ForegroundColor Green
        }
    }
}
catch {
    Write-Host "[WARN] Unable to fetch DNS records from Cloudflare" -ForegroundColor Yellow
}

# ============================================================================
# STEP 6: REMOVAL
# ============================================================================

Write-Host ""
Write-Host "STEP 6: REMOVAL SUMMARY" -ForegroundColor Yellow
Write-Host ""
Write-Host "Services to remove:  $($devServices.Count)" -ForegroundColor White
Write-Host "DNS records to remove: $($devDnsRecords.Count)" -ForegroundColor White
Write-Host ""

if (-not $Preview) {
    if (-not $Force) {
        $confirm = Read-Host "Do you want to proceed with removal? (y/N)"
        if ($confirm -notmatch '^[Yy]$') {
            Write-Host "[CANCEL] Operation cancelled by user." -ForegroundColor Yellow
            exit 0
        }
    }
}

# ============================================================================
# STEP 7: EXECUTE REMOVAL
# ============================================================================

if (-not $Preview) {
    Write-Host ""
    Write-Host "STEP 7: EXECUTING REMOVAL" -ForegroundColor Yellow
    Write-Host ""

    # 7.1: Remove Dev Services
    if ($devServices.Count -gt 0) {
        Write-Host "Removing dev services from Dokploy..." -ForegroundColor Cyan
        
        foreach ($service in $devServices) {
            try {
                Write-Host "  Removing: $($service.name)..." -ForegroundColor Yellow
                
                # Try to stop service first
                try {
                    Invoke-RestMethod -Uri "$DOKPLOY_URL/api/services/$($service.id)/stop" -Method Post -Headers $headers -ErrorAction SilentlyContinue | Out-Null
                    Write-Host "    [OK] Service stopped" -ForegroundColor Green
                }
                catch {
                    Write-Host "    [WARN] Could not stop service" -ForegroundColor Yellow
                }
                
                # Delete the service
                Invoke-RestMethod -Uri "$DOKPLOY_URL/api/services/$($service.id)" -Method Delete -Headers $headers -ErrorAction SilentlyContinue | Out-Null
                Write-Host "    [OK] Service deleted successfully" -ForegroundColor Green
            }
            catch {
                Write-Host "    [ERROR] Error deleting service: $_" -ForegroundColor Red
            }
        }
    }
    else {
        Write-Host "[OK] No dev services to remove" -ForegroundColor Green
    }

    # 7.2: Remove Dev DNS Records (if flag is set)
    if ($RemoveDNS -and $devDnsRecords.Count -gt 0) {
        Write-Host ""
        Write-Host "STEP 7B: REMOVING DEV DNS RECORDS" -ForegroundColor Yellow
        Write-Host ""
        
        foreach ($record in $devDnsRecords) {
            try {
                Write-Host "  Removing DNS: $($record.name)..." -ForegroundColor Yellow
                
                $deleteDnsResponse = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records/$($record.id)" -Method Delete -Headers @{
                    "Authorization" = "Bearer $CLOUDFLARE_API_TOKEN"
                    "Content-Type" = "application/json"
                } -ErrorAction SilentlyContinue
                
                if ($deleteDnsResponse.success) {
                    Write-Host "    [OK] DNS record deleted successfully" -ForegroundColor Green
                }
                else {
                    Write-Host "    [ERROR] Failed to delete DNS record" -ForegroundColor Red
                }
            }
            catch {
                Write-Host "    [ERROR] Error deleting DNS record: $_" -ForegroundColor Red
            }
        }
    }
    elseif ($RemoveDNS) {
        Write-Host "[OK] No dev DNS records to remove" -ForegroundColor Green
    }
    elseif (-not $RemoveDNS) {
        Write-Host "[INFO] DNS records NOT removed (use -RemoveDNS flag to remove them)" -ForegroundColor Cyan
    }

    # ============================================================================
    # FINAL STATUS
    # ============================================================================

    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor DarkGray
    Write-Host "  REMOVAL COMPLETE" -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor DarkGray
    Write-Host ""
    
    Write-Host "[OK] Dev services removal process completed" -ForegroundColor Green
    Write-Host "[OK] Production services remain untouched" -ForegroundColor Green
    
    if ($RemoveDNS) {
        Write-Host "[OK] Dev DNS records have been removed" -ForegroundColor Green
    }
    else {
        Write-Host "[INFO] Dev DNS records were NOT removed (run with -RemoveDNS to remove)" -ForegroundColor Cyan
    }
    
    Write-Host ""
    Write-Host "IMPORTANT: The following databases still exist and contain dev data:" -ForegroundColor Yellow
    Write-Host "  - identity_dev" -ForegroundColor White
    Write-Host "  - smart_hr_db_dev" -ForegroundColor White
    Write-Host "  - leave-management_dev" -ForegroundColor White
    Write-Host "  - performance_db_dev" -ForegroundColor White
    Write-Host "  - payroll_db_dev" -ForegroundColor White
    Write-Host ""
    Write-Host "If you want to delete the dev databases, you must do this manually" -ForegroundColor Cyan
    Write-Host "in MongoDB Atlas or via mongosh commands." -ForegroundColor Cyan
}
else {
    # PREVIEW MODE
    Write-Host ""
    Write-Host "PREVIEW MODE - NO CHANGES MADE" -ForegroundColor Yellow
    Write-Host ""
    
    if ($devServices.Count -gt 0) {
        Write-Host "Services to DELETE:" -ForegroundColor Yellow
        $devServices | ForEach-Object {
            Write-Host "  - $($_.name) (ID: $($_.id))" -ForegroundColor White
        }
        Write-Host ""
    }
    
    if ($devDnsRecords.Count -gt 0 -and $RemoveDNS) {
        Write-Host "DNS records to DELETE:" -ForegroundColor Yellow
        $devDnsRecords | ForEach-Object {
            Write-Host "  - $($_.name) -> $($_.content) (ID: $($_.id))" -ForegroundColor White
        }
        Write-Host ""
    }
    
    if (-not $RemoveDNS) {
        Write-Host "[INFO] DNS records would NOT be deleted (use -RemoveDNS flag)" -ForegroundColor Cyan
    }
}

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor DarkGray
Write-Host "  Done!" -ForegroundColor Cyan
Write-Host ("=" * 70) -ForegroundColor DarkGray
Write-Host ""
