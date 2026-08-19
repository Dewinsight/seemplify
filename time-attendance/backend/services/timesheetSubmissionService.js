function getTimesheetSubmissionError(timesheet) {
    const incompleteEntries = Math.max(0, Number(timesheet?.summary?.incompleteEntries || 0));
    if (incompleteEntries > 0) {
        return {
            error: 'This timesheet has incomplete or unpaired attendance entries. Correct them before submitting.',
            code: 'INCOMPLETE_ATTENDANCE_ENTRIES',
            incompleteEntries,
        };
    }
    return null;
}

module.exports = { getTimesheetSubmissionError };
