#!/usr/bin/env node
/**
 * Build-time validation script
 * 
 * This script validates that production builds don't contain localhost URLs.
 * Run this as part of the CI/CD pipeline to prevent localhost from being deployed.
 * 
 * Usage:
 *   node scripts/validate-production-build.js
 */

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '../.next');
const LOCALHOST_PATTERNS = [
    /localhost/i,
    /127\.0\.0\.1/,
    /http:\/\/localhost/,
    /https:\/\/localhost/,
];

let errors = [];
let warnings = [];

function checkFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const relativePath = path.relative(BUILD_DIR, filePath);
        
        LOCALHOST_PATTERNS.forEach((pattern, index) => {
            if (pattern.test(content)) {
                const matches = content.match(new RegExp(pattern.source, 'gi'));
                const error = {
                    file: relativePath,
                    pattern: pattern.source,
                    matches: matches?.length || 0,
                };
                
                // In production build, localhost is always an error
                if (process.env.NODE_ENV === 'production') {
                    errors.push(error);
                } else {
                    warnings.push(error);
                }
            }
        });
    } catch (err) {
        // Skip files that can't be read (binary, etc.)
    }
}

function walkDir(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            // Skip node_modules and other irrelevant directories
            if (!['node_modules', '.git'].includes(file)) {
                walkDir(filePath, fileList);
            }
        } else {
            // Only check JavaScript/TypeScript files
            if (/\.(js|jsx|ts|tsx|json)$/.test(file)) {
                fileList.push(filePath);
            }
        }
    });
    
    return fileList;
}

console.log('🔍 Validating production build for localhost references...\n');

if (!fs.existsSync(BUILD_DIR)) {
    console.error('❌ Build directory not found:', BUILD_DIR);
    console.error('   Run "npm run build" first');
    process.exit(1);
}

// Find all JS/TS files in build directory
const files = walkDir(BUILD_DIR);
console.log(`📁 Checking ${files.length} files...\n`);

// Check each file
files.forEach(checkFile);

// Report results
if (errors.length > 0) {
    console.error('❌ PRODUCTION BUILD VALIDATION FAILED\n');
    console.error('Found localhost references in production build:\n');
    errors.forEach((error, index) => {
        console.error(`  ${index + 1}. ${error.file}`);
        console.error(`     Pattern: ${error.pattern}`);
        console.error(`     Matches: ${error.matches}\n`);
    });
    console.error('⚠️  This build should NOT be deployed to production!');
    console.error('   Fix the issues above and rebuild.\n');
    process.exit(1);
}

if (warnings.length > 0) {
    console.warn('⚠️  Warnings (non-production build):\n');
    warnings.forEach((warning, index) => {
        console.warn(`  ${index + 1}. ${warning.file}`);
        console.warn(`     Pattern: ${warning.pattern}\n`);
    });
}

console.log('✅ Production build validation passed!');
console.log('   No localhost references found.\n');
process.exit(0);
