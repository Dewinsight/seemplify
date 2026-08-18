const ORGANIZATION_PLAN_MANAGER_ROLES = Object.freeze(['owner', 'admin']);

function organizationPlanManagerFilter(organizationId, userId) {
  return {
    _id: organizationId,
    $or: [
      { owner: userId },
      {
        members: {
          $elemMatch: {
            user: userId,
            role: { $in: [...ORGANIZATION_PLAN_MANAGER_ROLES] },
            status: 'active'
          }
        }
      }
    ]
  };
}

module.exports = {
  ORGANIZATION_PLAN_MANAGER_ROLES,
  organizationPlanManagerFilter
};
