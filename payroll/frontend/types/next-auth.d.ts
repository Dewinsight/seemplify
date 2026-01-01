import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    userRole?: string;
    teams?: any[];
    organizations?: any[];
    name?: string;
    email?: string;
  }
}


