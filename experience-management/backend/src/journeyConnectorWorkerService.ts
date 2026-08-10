import type { JourneyConnectorWorkerPrincipal } from './journeyConnectorWorkerDomain.js';
import { JourneyConnectorWorkerRepository } from './journeyConnectorWorkerRepository.js';

export class JourneyConnectorWorkerService {
  constructor(private repository:JourneyConnectorWorkerRepository,private authority:JourneyConnectorWorkerPrincipal,
    private clock:()=>Date=()=>new Date()){}
  runOnce(){const at=this.clock().toISOString();const lease=this.repository.claim({authority:this.authority,now:at,leaseSeconds:60});if(!lease)return null;
    try{if(lease.phase==='scan'){const rows=this.repository.ticketPage(lease);return{lease,result:this.repository.commitTicketPage({authority:this.authority,lease,rows,at:this.clock().toISOString()})};}
      const rows=this.repository.deletionPage(lease);return{lease,result:this.repository.commitDeletionPage({authority:this.authority,lease,rows,at:this.clock().toISOString()})};
    }catch(error){const code=error instanceof Error&&/^[A-Z0-9_]{1,100}$/u.test((error as any).code)?String((error as any).code):'ADAPTER_EXECUTION_FAILED';
      try{this.repository.fail({authority:this.authority,lease,code,at:this.clock().toISOString()});}catch{/* stale/reaped lease owns its recovery */}throw error;}}
  reap(){return this.repository.reapExpired(this.clock().toISOString());}
}

export class JourneyConnectorWorkerScheduler {
  private timer:ReturnType<typeof setInterval>|null=null;private running=false;
  constructor(private worker:JourneyConnectorWorkerService,private intervalMs=5_000){if(intervalMs<250||intervalMs>60_000)throw new Error('Connector worker scheduler interval is invalid.');}
  start(){if(this.timer)return;this.timer=setInterval(()=>{void this.tick();},this.intervalMs);this.timer.unref?.();}
  async tick(){if(this.running)return false;this.running=true;try{this.worker.reap();this.worker.runOnce();return true;}finally{this.running=false;}}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}
