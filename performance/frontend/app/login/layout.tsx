import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login - Performance Management",
  description: "Sign in to Performance Management System",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}






