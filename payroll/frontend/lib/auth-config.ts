import { NextAuthOptions } from "next-auth";

// Fetch userinfo from IdP to get full profile data
async function fetchUserInfo(accessToken: string) {
  const idpUrl = process.env.OIDC_ISSUER || 'http://localhost:4000';
  try {
    const response = await fetch(`${idpUrl}/oidc/userinfo`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      console.error('Failed to fetch userinfo:', response.status);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching userinfo:', error);
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "aiin",
      name: "AIIN",
      type: "oauth",
      wellKnown: process.env.OIDC_ISSUER + "/.well-known/openid-configuration",
      authorization: { params: { scope: "openid profile email teams organizations roles team_permissions" } },
      idToken: true,
      checks: ["pkce", "state"],
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET!,
      issuer: process.env.OIDC_ISSUER,
      // Use userinfo endpoint to get full profile data
      userinfo: {
        url: process.env.OIDC_ISSUER + "/oidc/userinfo",
      },
      profile(profile: any) {
        return {
          id: profile.sub,
          name: profile.name || profile.preferred_username || profile.email?.split('@')[0],
          email: profile.email,
          role: profile.role,
          image: profile.picture,
          teams: profile.teams,
          organizations: profile.organizations,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (account && user) {
        // Fetch userinfo for complete profile data
        let userinfo = null;
        if (account.access_token) {
          userinfo = await fetchUserInfo(account.access_token);
        }

        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          userRole: userinfo?.role || (user as any).role,
          teams: userinfo?.teams || (user as any).teams,
          organizations: userinfo?.organizations || (user as any).organizations,
          name: userinfo?.name || user.name || (profile as any)?.name || token.name,
          email: userinfo?.email || user.email || token.email,
        };
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.userRole;
        (session.user as any).teams = token.teams;
        (session.user as any).organizations = token.organizations;
        session.user.name = token.name;
        session.user.email = token.email;
        (session.user as any).accessToken = token.accessToken;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    signOut: '/login',
    error: '/login',
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === 'development',
};

