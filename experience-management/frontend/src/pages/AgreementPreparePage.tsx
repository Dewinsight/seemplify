import { Navigate, useParams } from '@/lib/router';

export function AgreementPreparePage() {
  const { id = '' } = useParams();
  return <Navigate to={`/agreements/${id}?step=fields`} />;
}
