import { redirect } from 'next/navigation';

export default function OnboardRedirectPage({ params }: { params: { id: string } }) {
  redirect(`/admin/employees/${params.id}`);
}

