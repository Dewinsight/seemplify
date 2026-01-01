// 2 CLEAR Subscription Plans
const SUBSCRIPTION_PLANS = {
  USER: 'user',
  ADMIN: 'admin'
};

// Plan features - Note: These are fallback constants, primary source is Plan model in database
const PLAN_FEATURES = {
  [SUBSCRIPTION_PLANS.USER]: {
    name: 'User Plan',
    memberLimit: 25,
    price: 79,
    features: [
      'Candidate Management',
      'Job Posting & Management', 
      'Interview Scheduling',
      'Team Collaboration',
      'AI-Powered CV Parsing',
      'Basic Analytics & Reports',
      'Email Integration',
      'Mobile Access'
    ]
  },
  [SUBSCRIPTION_PLANS.ADMIN]: {
    name: 'Admin Plan',
    memberLimit: 'unlimited',
    price: 199,
    features: [
      'All User Plan Features',
      'System Administration',
      'User Management',
      'Organization Management',
      'Advanced Analytics',
      'Billing & License Management',
      'API Access & Integration',
      'Priority Support',
      'Custom Branding',
      'Advanced Security'
    ]
  }
};

module.exports = {
  SUBSCRIPTION_PLANS,
  PLAN_FEATURES
};

