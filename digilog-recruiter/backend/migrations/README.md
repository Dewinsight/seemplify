# Feedback Form Migration Script

This script creates default feedback form templates for all existing organizations and updates jobs to use them.

## Usage

### Dry Run (No Changes)
Test the migration without making any changes:
```bash
node backend/migrations/migrateFeedbackData.js --dry-run
```

### Execute Migration
Run the actual migration:
```bash
node backend/migrations/migrateFeedbackData.js
```

## What It Does

1. **Creates Default Templates**: For each organization that doesn't have a default feedback form template, creates one with all standard system fields enabled
2. **Updates Organizations**: Sets the `defaultFeedbackTemplate` reference in organization settings
3. **Updates Jobs**: Configures existing jobs to use the newly created default template
4. **Verification**: Runs checks to ensure all organizations have templates

## Safety

- Always run with `--dry-run` first to see what will happen
- The script is idempotent - safe to run multiple times
- Skips organizations that already have default templates
- Provides detailed logging of all operations

## Output

The script provides:
- Progress logging for each organization
- Summary statistics
- Verification results
- Error details if any issues occur

