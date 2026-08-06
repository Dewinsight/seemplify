# Convert lms-login.html from UTF-16 LE to UTF-8 (no BOM)
# Only convert if file starts with UTF-16 BOM (0xFF 0xFE)
$paths = @(
    "c:\Users\Michael\Documents\GitHub\seemplify\lms\www\lms-login.html",
    "c:\Users\Michael\Documents\GitHub\seemplify\lms\lms\www\lms-login.html"
)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
foreach ($p in $paths) {
    if (Test-Path $p) {
        $bytes = [System.IO.File]::ReadAllBytes($p)
        # Check for UTF-16 LE BOM
        if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
            $content = [System.Text.Encoding]::Unicode.GetString($bytes)
            [System.IO.File]::WriteAllText($p, $content, $utf8NoBom)
            Write-Host "Converted (UTF-16->UTF-8): $p"
        } else {
            Write-Host "Skipped (not UTF-16): $p"
        }
    }
}
