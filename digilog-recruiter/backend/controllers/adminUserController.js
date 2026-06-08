const User = require('../models/User');
const Organization = require('../models/Organization');
const Interview = require('../models/Interview');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');

/**
 * Hard delete a user by ID
 * This will remove the user completely from the system, allowing re-registration
 */
exports.removeUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    // Find user to verify they exist
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Get count of user-owned organizations
    const ownedOrganizations = await Organization.find({ owner: userId });
    
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
    const interviewCount = await Interview.countDocuments({ user: userId });
    const candidateCount = await Candidate.countDocuments({ createdBy: userId });
    const jobCount = await Job.countDocuments({ createdBy: userId });

    console.log(`Admin removing user ${userId} (${user.email}) who has ${interviewCount} interviews, ${candidateCount} candidates, and ${jobCount} jobs.`);
    
    // If force=true, handle organization ownership transfer or deletion
    if (req.query.force === 'true' && ownedOrganizations.length > 0) {
      console.log(`Force-deleting user with ${ownedOrganizations.length} owned organizations`);
      
      // Delete all owned organizations
      for (const org of ownedOrganizations) {
        console.log(`Deleting organization ${org._id} owned by user ${userId}`);
        
        // Remove organization from all users' memberships
        await User.updateMany(
          { 'organizationMemberships.organization': org._id },
          { 
            $pull: { organizationMemberships: { organization: org._id } },
            $unset: { currentOrganization: 1 }
          }
        );
        
        // Delete the organization
        await Organization.deleteOne({ _id: org._id });
      }
    }
    
    // Remove user from all organization memberships
    await Organization.updateMany(
      { 'members.user': userId },
      { $pull: { members: { user: userId } } }
    );
    
    // Hard delete the user
    await User.deleteOne({ _id: userId });
    
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
