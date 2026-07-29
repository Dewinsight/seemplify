import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { App } from './App';
import './styles.css';

const STALE_ASSET_RECOVERY_KEY = 'seemplify-experience:last-asset-recovery';
const STALE_ASSET_RECOVERY_WINDOW_MS = 60_000;
let staleAssetRecoveryScheduled = false;

window.addEventListener('vite:preloadError', (event: Event) => {
  event.preventDefault();
  if (staleAssetRecoveryScheduled) return;
  const now = Date.now();
  try {
    const lastRecovery = Number(window.sessionStorage.getItem(STALE_ASSET_RECOVERY_KEY) || 0);
    if (lastRecovery > 0 && now - lastRecovery < STALE_ASSET_RECOVERY_WINDOW_MS) return;
    window.sessionStorage.setItem(STALE_ASSET_RECOVERY_KEY, String(now));
  } catch {
    const navigation = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.type === 'reload') return;
  }
  staleAssetRecoveryScheduled = true;
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster position="bottom-right" richColors closeButton />
  </StrictMode>
);
