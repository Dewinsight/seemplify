'use client';

import { usePathname } from 'next/navigation';
import Layout from './Layout';
import PageGuide from './PageGuide';
import AppraisalCompetencySlot from './competency/AppraisalCompetencySlot';
import AssessmentMeetingReturn from './competency/AssessmentMeetingReturn';
import CalendarRecordingConsent from './competency/CalendarRecordingConsent';
import AppraisalRecordingConsents from './competency/AppraisalRecordingConsents';

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Don't show Layout on root page (root is just a redirect handler)
  if (pathname === '/') {
    return <>{children}</>;
  }

  if (pathname === '/login') {
    return (
      <>
        {children}
        <PageGuide pathnameOverride="/login" showBanner={false} />
      </>
    );
  }
  
  const appraisalId = /^\/appraisals\/([a-fA-F0-9]{24})$/.exec(pathname)?.[1];
  const oneOnOneId = /^\/one-on-ones\/([a-fA-F0-9]{24})$/.exec(pathname)?.[1];
  return <Layout>{oneOnOneId && <AssessmentMeetingReturn />}{children}{oneOnOneId && <CalendarRecordingConsent callBase={`/one-on-ones/${oneOnOneId}/call`} />}{appraisalId && <><AppraisalCompetencySlot appraisalId={appraisalId} /><AppraisalRecordingConsents appraisalId={appraisalId} /></>}</Layout>;
}







