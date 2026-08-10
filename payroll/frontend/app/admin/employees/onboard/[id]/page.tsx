import { redirect } from 'next/navigation';

// Compatibility route for bookmarked links. Payroll no longer describes
// configuration as creating or onboarding an employee; identity and employee
// membership are owned by the Identity Provider.
export default function LegacyOnboardEmployeePage({ params }: { params: { id: string } }) {
  redirect(`/admin/employees/configure/${params.id}`);
}
