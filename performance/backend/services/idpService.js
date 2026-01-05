/**
 * IdP Service
 * Helper functions for working with IdP team and organization data
 */

/**
 * Find the manager for an employee based on team claims
 * Searches through teams to find a line_manager whose directReports includes this employee
 * 
 * @param {string} employeeAccountId - The employee's account ID
 * @param {Array} teams - Teams from IdP claims (userinfo.teams or session.user.idpTeams)
 * @returns {Object|null} Manager info or null if not found
 */
function findManagerForEmployee(employeeAccountId, teams) {
    if (!teams || !Array.isArray(teams)) return null;

    for (const team of teams) {
        // Check if this team has directReports that includes the employee
        if (team.directReports && team.directReports.includes(employeeAccountId)) {
            return {
                userId: team.managerId,
                name: team.managerName,
                email: team.managerEmail || null,
                teamId: team.id,
                teamName: team.name
            };
        }
    }

    return null;
}

/**
 * Get all direct reports for a user across all their teams
 * 
 * @param {Array} teams - Teams from IdP claims
 * @returns {Array} Array of unique account IDs
 */
function getAllDirectReports(teams) {
    if (!teams || !Array.isArray(teams)) return [];

    const allReports = new Set();

    for (const team of teams) {
        if (team.directReports && Array.isArray(team.directReports)) {
            team.directReports.forEach(id => allReports.add(id));
        }
    }

    return Array.from(allReports);
}

module.exports = {
    findManagerForEmployee,
    getAllDirectReports
};
