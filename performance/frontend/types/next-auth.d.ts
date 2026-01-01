import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      role?: string;
    } & DefaultSession["user"];
    accessToken?: string;
  }

  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userRole?: string;
    accessToken?: string;
    refreshToken?: string;
  }
}
