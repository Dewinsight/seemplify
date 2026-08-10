import type { WorkerAuthority } from './journeyActionWorkerDomain.js';
import type { JourneyActionWorkerService, WorkerTelemetrySink } from './journeyActionWorkerService.js';

export class JourneyActionWorkerScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false; private stopped = true;
  constructor(private readonly service: JourneyActionWorkerService, private readonly authority: WorkerAuthority,
    private readonly telemetry: WorkerTelemetrySink, private readonly intervalMs = 1_000,
    private readonly schedule: typeof setTimeout = setTimeout, private readonly unschedule: typeof clearTimeout = clearTimeout,
    private readonly maintenance:()=>void=()=>{},
    private readonly executeReviewed?:(authority:WorkerAuthority,lease:NonNullable<Awaited<ReturnType<JourneyActionWorkerService['claim']>>>)=>Promise<unknown>) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 10 || intervalMs > 300_000) throw new Error('Invalid scheduler interval.');
  }
  start(): void { if (!this.stopped) return; this.stopped = false; this.queue(); }
  stop(): void { this.stopped = true; if (this.timer) this.unschedule(this.timer); this.timer = null; }
  private queue(): void { if (!this.stopped && !this.timer) this.timer = this.schedule(() => { this.timer = null; void this.tick(); }, this.intervalMs); }
  async tick(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      this.maintenance();
      await this.service.reevaluateHeld(this.authority, 100);
      const lease = await this.service.claim(this.authority);
      if (lease) {
        try {
          if(this.executeReviewed)await this.executeReviewed(this.authority,lease);
          else await this.service.completeNoEffect(this.authority, lease);
        } catch(error) {
          const code=error instanceof Error&&'code'in error&&/^[A-Z][A-Z0-9_]{2,127}$/u.test(String((error as {code:unknown}).code))
            ?String((error as {code:unknown}).code):'REVIEWED_ADAPTER_EXECUTION_FAILED';
          await this.service.fail(this.authority,lease,code).catch(()=>undefined);
          throw error;
        }
      }
    } catch {
      this.telemetry.emit(Object.freeze({ event: 'scheduler_error', workerIdSha256: this.authority.workerIdSha256,
        reasonCode: 'SCHEDULER_TICK_FAILED', at: new Date().toISOString() }));
    } finally { this.running = false; this.queue(); }
  }
  get isStarted(): boolean { return !this.stopped; }
  async drain(timeoutMs=10_000):Promise<boolean>{const deadline=Date.now()+timeoutMs;while(this.running&&Date.now()<deadline){await new Promise((resolve)=>setTimeout(resolve,10));}
    return !this.running;}
}
