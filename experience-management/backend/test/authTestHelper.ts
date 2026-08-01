type TestAgent = {
  post(path: string): {
    send(body: unknown): {
      expect(status: number): Promise<{ body: any }>;
    };
  };
};

export async function signupVerifyAndOnboard(agent: TestAgent, input: {
  name: string;
  email: string;
  password: string;
  spaceName?: string;
  inviteToken?: string;
}) {
  const signup = await agent.post('/api/auth/signup').send(input).expect(202);
  const { issueEmailVerificationToken } = await import('../src/auth.js');
  const verification = issueEmailVerificationToken(input.email);
  if (!verification) throw new Error(`Could not issue an email verification token for ${input.email}.`);
  const verified = await agent.post('/api/auth/verify-email').send({ token: verification.token }).expect(200);
  const onboarded = await agent.post('/api/account/onboarding').send({
    name: input.name,
    jobTitle: 'Researcher',
    organizationName: 'Test organisation',
    timezone: 'UTC',
    primaryGoal: 'customer_experience'
  }).expect(200);
  return { signup, verified, onboarded, body: onboarded.body };
}
