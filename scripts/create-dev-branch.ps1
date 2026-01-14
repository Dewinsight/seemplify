# Create Dev Branch Script
# Creates and pushes the dev branch to GitHub

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Create Dev Branch" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in a git repository
if (-not (Test-Path ".git")) {
    Write-Host "❌ Error: Not in a git repository root!" -ForegroundColor Red
    Write-Host "Please run this script from the repository root." -ForegroundColor Yellow
    exit 1
}

# Check git status
Write-Host "Checking git status..." -ForegroundColor Cyan
git status

$uncommitted = git status --porcelain
if ($uncommitted) {
    Write-Host ""
    Write-Host "⚠️  You have uncommitted changes!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Uncommitted files:" -ForegroundColor Yellow
    git status --short
    Write-Host ""
    
    $continue = Read-Host "Do you want to continue anyway? (y/N)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        Write-Host "Aborted." -ForegroundColor Gray
        exit 0
    }
}

Write-Host ""
Write-Host "📥 Fetching latest from remote..." -ForegroundColor Cyan
git fetch origin

# Check if dev branch already exists
$devExists = git branch --list dev
$remoteDev exists = git branch -r --list origin/dev

if ($devExists -or $remoteDevExists) {
    Write-Host ""
    Write-Host "⚠️  Dev branch already exists!" -ForegroundColor Yellow
    Write-Host ""
    
    if ($devExists) {
        Write-Host "  • Local 'dev' branch exists" -ForegroundColor Gray
    }
    if ($remoteDevExists) {
        Write-Host "  • Remote 'origin/dev' branch exists" -ForegroundColor Gray
    }
    
    Write-Host ""
    $recreate = Read-Host "Do you want to recreate it from current main? (y/N)"
    
    if ($recreate -ne "y" -and $recreate -ne "Y") {
        Write-Host ""
        Write-Host "✅ Using existing dev branch" -ForegroundColor Green
        Write-Host ""
        Write-Host "To switch to dev branch:" -ForegroundColor Cyan
        Write-Host "  git checkout dev" -ForegroundColor White
        Write-Host "  git pull origin dev" -ForegroundColor White
        exit 0
    }
    
    # Delete existing dev branches
    Write-Host ""
    Write-Host "🗑️  Deleting existing dev branches..." -ForegroundColor Yellow
    
    if ($devExists) {
        git branch -D dev 2>&1 | Out-Null
        Write-Host "  ✅ Deleted local dev branch" -ForegroundColor Green
    }
    
    if ($remoteDevExists) {
        Write-Host "  ⚠️  Remote dev branch will be overwritten" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Creating dev branch from main..." -ForegroundColor Cyan
Write-Host ""

# Ensure we're on main and it's up to date
Write-Host "1️⃣  Checking out main branch..." -ForegroundColor White
git checkout main

Write-Host "2️⃣  Pulling latest changes from origin/main..." -ForegroundColor White
git pull origin main

Write-Host "3️⃣  Creating dev branch from main..." -ForegroundColor White
git checkout -b dev

Write-Host "4️⃣  Pushing dev branch to origin..." -ForegroundColor White
git push -u origin dev

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ✅ Dev Branch Created!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "The dev branch has been created and pushed to GitHub." -ForegroundColor Green
Write-Host ""

Write-Host "📋 Next steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Set up Dokploy applications to use dev branch:" -ForegroundColor White
Write-Host "   • Open Dokploy dashboard" -ForegroundColor Gray
Write-Host "   • For each -dev application, change Git branch to 'dev'" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Create GitHub secrets for dev app IDs:" -ForegroundColor White
Write-Host "   • See: access/GITHUB-SECRETS-SETUP-GUIDE.md" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Test deployment:" -ForegroundColor White
Write-Host "   • Make a small change" -ForegroundColor Gray
Write-Host "   • Push to dev branch" -ForegroundColor Gray
Write-Host "   • Verify GitHub Actions triggers" -ForegroundColor Gray
Write-Host "   • Check deployment in Dokploy" -ForegroundColor Gray
Write-Host ""

Write-Host "🌳 Branch structure:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  main (production)" -ForegroundColor Green
Write-Host "    ↑" -ForegroundColor Gray
Write-Host "    └── dev (development) ← You are here" -ForegroundColor Yellow
Write-Host "         ↑" -ForegroundColor Gray
Write-Host "         └── feature/* (your features)" -ForegroundColor Cyan
Write-Host ""

Write-Host "📖 Documentation:" -ForegroundColor Cyan
Write-Host "   access/BRANCHING-STRATEGY-GUIDE.md" -ForegroundColor Gray
Write-Host ""

Write-Host "Current branch: " -NoNewline
git branch --show-current | Write-Host -ForegroundColor Yellow

Write-Host ""
Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
