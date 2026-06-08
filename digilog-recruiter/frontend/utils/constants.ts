// Subscription Plans
// Organization Plans Only - Users can create unlimited organizations
export const SUBSCRIPTION_PLANS = {
  // Organization Plans  
  ORG_STARTER: 'org-starter',
  ORG_ENTERPRISE: 'org-enterprise'
};

// Plan features - Note: These are fallback constants, primary source is Plan model via API
// Only organization plans exist - users can create unlimited organizations
export const PLAN_FEATURES = {
  // ORGANIZATION PLANS (Control Internal Resources)
  [SUBSCRIPTION_PLANS.ORG_STARTER]: {
    name: 'Starter',
    memberLimit: 10,
    storageLimit: '5GB',
    price: 99,
    features: [
      'Up to 10 team members',
      'Jobs & candidates managed by credits',
      'Basic analytics',
      'Email support',
      '5GB file storage'
    ]
  },
  [SUBSCRIPTION_PLANS.ORG_ENTERPRISE]: {
    name: 'Enterprise',
    memberLimit: 'unlimited',
    storageLimit: 'unlimited',
    price: 299,
    features: [
      'Unlimited team members',
      'Jobs & candidates managed by credits',
      'Advanced analytics',
      'Priority support',
      'Unlimited storage',
      'API access',
      'Custom integrations'
    ]
  },
  
  // LEGACY SUPPORT FOR ORGANIZATION PLANS ONLY
  'free': {
    name: 'Free',
    memberLimit: 3,
    price: 0,
    features: [
      'Legacy free organization plan',
      'Basic features'
    ]
  },
  'basic': {
    name: 'Basic',
    memberLimit: 10,
    price: 29,
    features: [
      'Legacy basic organization plan',
      'Standard features'
    ]
  },
  'pro': {
    name: 'Pro',
    memberLimit: 50,
    price: 99,
    features: [
      'Legacy pro organization plan',
      'Advanced features'
    ]
  },
  'enterprise': {
    name: 'Enterprise',
    memberLimit: 'unlimited',
    price: 299,
    features: [
      'Legacy enterprise organization plan',
      'Premium features'
    ]
  }
};
