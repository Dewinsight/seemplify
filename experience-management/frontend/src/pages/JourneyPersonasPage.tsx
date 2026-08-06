import { JourneyPersonaLibrary } from '@/components/journeys/JourneyPersonaLibrary';
import { useSessionFeature } from '@/lib/authSessionContext';

export function JourneyPersonasPage() {
  const enabled = useSessionFeature('journeyPersonas');
  if (!enabled) return <div className="border px-5 py-10 text-center">
    <h1 className="text-lg font-semibold">Personas are not available</h1>
    <p className="mt-2 text-sm text-muted-foreground">This space's plan does not include the persona library.</p>
  </div>;
  return <JourneyPersonaLibrary />;
}
