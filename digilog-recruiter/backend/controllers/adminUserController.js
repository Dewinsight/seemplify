const prisma = require('../db/client');

/**
 * Hard delete a user by ID
 * This will remove the user completely from the system, allowing re-registration
 */
exports.removeUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    // Find user to verify they exist
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Get count of user-owned organizations
    const ownedOrganizations = await prisma.organization.findMany({ where: { ownerId: userId } });

    // If user owns organizations, prevent deletion unless force flag is true
    if (ownedOrganizations.length > 0 && req.query.force !== 'true') {
      return res.status(400).json({ 
        msg: 'User owns organizations. Transfer ownership or use force=true parameter to delete anyway.',
        ownsOrganizations: true,
        ownedOrganizationCount: ownedOrganizations.length,
        ownedOrganizationIds: ownedOrganizations.map(org => org._id)
      });
    }

    // Get statistics of user activities for logging
    // NOTE: the Interview model never had a `user` field, so this count was always 0 in Mongo.
    const interviewCount = 0;
    const candidateCount = await prisma.candidate.count({ where: { createdBy: userId } });
    const jobCount = await prisma.job.count({ where: { createdById: userId } });

    console.log(`Admin removing user ${userId} (${user.email}) who has ${interviewCount} interviews, ${candidateCount} candidates, and ${jobCount} jobs.`);
    
    // If force=true, handle organization ownership transfer or deletion
    if (req.query.force === 'true' && ownedOrganizations.length > 0) {
      console.log(`Force-deleting user with ${ownedOrganizations.length} owned organizations`);
      
      // Delete all owned organizations
      for (const org of ownedOrganizations) {
        console.log(`Deleting organization ${org._id} owned by user ${userId}`);

        // Clear currentOrganization for any user pointing at this org
        await prisma.user.updateMany(
          { where: { currentOrganizationId: org.id }, data: { currentOrganizationId: null } }
        );

        // Remove all memberships for this org (OrganizationMember rows cascade on org delete,
        // but remove explicitly to mirror the old $pull cleanup)
        await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });

        // Delete the organization
        await prisma.organization.delete({ where: { id: org.id } });
      }
    }

    // Remove user from all organization memberships
    await prisma.organizationMember.deleteMany({ where: { userId } });

    // Hard delete the user
    await prisma.user.delete({ where: { id: userId } });
    
    res.json({ 
      msg: 'User successfully removed from the system',
      email: user.email,
      stats: {
        organizations: ownedOrganizations.length,
        interviews: interviewCount,
        candidates: candidateCount,
        jobs: jobCount
      }
    });
  } catch (error) {
    console.error('Error removing user:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};
