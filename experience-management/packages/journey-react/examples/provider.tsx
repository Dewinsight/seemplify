import React, { useEffect, type ReactNode } from 'react';
import {
  JourneyProvider,
  useJourneyPage,
  useJourneyTrack
} from '@seemplify/journey-react';

// Phase 5A example only. A durable Seemplify ingest endpoint does not exist yet.
export function JourneyObservationProvider({ children }: { children: ReactNode }) {
  return (
    <JourneyProvider
      config={{
        writeKey: 'jpk_dev.replace_me.00000000000000000000000000000000',
        endpoint: 'https://ingest.example.com',
        environment: 'development',
        consent: {
          analytics: 'granted',
          source: 'example_cmp',
          updatedAt: new Date().toISOString()
        }
      }}
      instanceKey="example-test-source"
    >
      {children}
    </JourneyProvider>
  );
}

export function PageObservation({ name }: { name: string }) {
  const page = useJourneyPage();
  useEffect(() => { void page(name); }, [name, page]);
  return null;
}

export function useSurveyPublishedObservation() {
  const track = useJourneyTrack();
  return (surveyId: string) => track('survey_published', { survey_id: surveyId });
}
