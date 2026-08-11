import type { ReactNode } from "react";
import "../../styles/people-transitions.css";

export default function PeopleTransitionsLayout({ children }: { children: ReactNode }) {
  return <div className="people-transitions-workspace">{children}</div>;
}
