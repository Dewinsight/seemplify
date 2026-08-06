import type { CandidateAccount } from "./types";

export function fullName(account?: CandidateAccount | null) {
  if (!account) return "Candidate";
  return (
    account.name ||
    `${account.firstName || ""} ${account.lastName || ""}`.trim() ||
    account.email ||
    "Candidate"
  );
}
