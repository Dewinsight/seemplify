'use client';
import useSWR from 'swr';
import api from '@/lib/api';
import CalendarRecordingConsent from './CalendarRecordingConsent';
type Meeting = { _id: string; title: string; mode?: string; integration?: { recordingRequested?: boolean } };
export default function AppraisalRecordingConsents({ appraisalId }: { appraisalId: string }) {
  const base = `/appraisals/${appraisalId}/meetings`;
  const { data } = useSWR<Meeting[]>(base, async path => (await api.get(path)).data.data, { refreshInterval: 30000 });
  return <>{(Array.isArray(data) ? data : []).filter(meeting => meeting.mode === 'calendar' && meeting.integration?.recordingRequested).map(meeting => <CalendarRecordingConsent key={meeting._id} title={meeting.title} callBase={`${base}/${meeting._id}`} />)}</>;
}
