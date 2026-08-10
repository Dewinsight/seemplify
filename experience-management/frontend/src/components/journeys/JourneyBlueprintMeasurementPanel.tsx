import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  closeJourneyBlueprintMeasurement,createJourneyBlueprintMeasurement,listJourneyBlueprintMeasurements,
  readJourneyBlueprintMeasurement,recordJourneyBlueprintMeasurementOutcome,type JourneyBlueprintMeasurementOutcome,
  type JourneyBlueprintMeasurementPlan
} from '@/lib/journeyBlueprintMeasurements';
import { listJourneyMetricDefinitions,listJourneyMetricObservations,type JourneyMetricDefinition,
  type JourneyMetricObservation } from '@/lib/journeyMetrics';
import type { JourneyBlueprintVersion } from '@/lib/journeyServiceBlueprint';

const date=(value:string)=>new Date(value).toLocaleDateString();
const number=(value:number|null,unit='')=>value===null?'Not set':`${new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value)}${unit?` ${unit}`:''}`;
const message=(reason:unknown)=>reason instanceof Error?reason.message:'Blueprint measurements could not be updated.';

export function JourneyBlueprintMeasurementPanel({version,canManage}:{version:JourneyBlueprintVersion;canManage:boolean}){
  const [plans,setPlans]=useState<JourneyBlueprintMeasurementPlan[]>([]),[definitions,setDefinitions]=useState<JourneyMetricDefinition[]>([]);
  const [observations,setObservations]=useState<JourneyMetricObservation[]>([]),[selectedId,setSelectedIdState]=useState('');
  const [outcomes,setOutcomes]=useState<JourneyBlueprintMeasurementOutcome[]>([]),[elementId,setElementId]=useState('');
  const [definitionId,setDefinitionId]=useState(''),[baselineId,setBaselineId]=useState(''),[afterId,setAfterId]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const selected=plans.find((plan)=>plan.id===selectedId)||null;
  const definition=definitions.find((item)=>item.id===definitionId)||null;
  const baselineOptions=observations.filter((item)=>item.status==='available'&&item.value!==null&&item.definitionId===definitionId
    &&item.definitionVersionId===definition?.currentVersionId);
  const afterOptions=selected?observations.filter((item)=>item.status==='available'&&item.value!==null
    &&item.definitionId===selected.metric_definition_id&&item.definitionVersionId===selected.metric_definition_version_id
    &&item.unit===selected.baseline_unit&&Date.parse(item.period.start)>=Date.parse(selected.baseline_period_end)):[];
  const elementName=(id:string)=>version.elements.find((item)=>item.id===id)?.title||id;
  const metricName=(id:string)=>definitions.find((item)=>item.id===id)?.name||id;
  async function load(){if(!version.versionId)return;setLoading(true);setError('');try{const [nextPlans,nextDefinitions,nextObservations]=
    await Promise.all([listJourneyBlueprintMeasurements(version.versionId),listJourneyMetricDefinitions(version.journeyDefinitionId),
      listJourneyMetricObservations({journeyDefinitionId:version.journeyDefinitionId})]);setPlans(nextPlans);setDefinitions(nextDefinitions);
    setObservations(nextObservations.observations);const nextSelected=nextPlans.find((item)=>item.id===selectedId)?.id||nextPlans[0]?.id||'';
    setSelectedIdState(nextSelected);if(nextSelected)setOutcomes((await readJourneyBlueprintMeasurement(nextSelected)).outcomes);else setOutcomes([]);
  }catch(reason){setError(message(reason));}finally{setLoading(false);}}
  useEffect(()=>{void load();},[version.versionId]);
  async function selectPlan(planId:string){setSelectedIdState(planId);setError('');try{
    setOutcomes((await readJourneyBlueprintMeasurement(planId)).outcomes);}catch(reason){setError(message(reason));}}
  function setSelectedId(planId:string){void selectPlan(planId);}
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();await load();}catch(reason){setError(message(reason));}finally{setBusy(false);}};
  async function create(event:FormEvent){event.preventDefault();if(!version.versionId||!definition?.currentVersionId)return;
    await run(async()=>{const plan=await createJourneyBlueprintMeasurement({blueprintVersionId:version.versionId||'',elementId,
      metricDefinitionId:definition.id,metricDefinitionVersionId:definition.currentVersionId||'',baselineObservationId:baselineId});
      await selectPlan(plan.id);setElementId('');setDefinitionId('');setBaselineId('');});}
  async function record(event:FormEvent){event.preventDefault();if(!selected||!afterId)return;await run(async()=>{
    const outcome=await recordJourneyBlueprintMeasurementOutcome(selected,afterId);setOutcomes((current)=>
      current.some((item)=>item.id===outcome.id)?current:[...current,outcome]);setAfterId('');});}
  if(loading)return <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin"/>Loading measurements…</div>;
  return <section className="min-w-0 border" aria-labelledby="blueprint-measurements-heading" data-testid="journey-blueprint-measurements">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3"><div><h2 id="blueprint-measurements-heading" className="text-sm font-semibold">Blueprint measurements</h2><p className="mt-1 text-sm text-muted-foreground">Pinned observations compare an immutable baseline with a later period. Results are descriptive, not causal.</p></div><Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void load()}><RefreshCw className="h-4 w-4"/>Refresh</Button></div>
    {error&&<div role="alert" className="border-b border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
    {canManage&&<form className="grid gap-3 border-b p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={(event)=>void create(event)}>
      <div className="grid gap-1.5"><Label htmlFor="measurement-element">Blueprint element</Label><select id="measurement-element" required className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" value={elementId} onChange={(event)=>setElementId(event.target.value)}><option value="">Choose element</option>{version.elements.map((item)=><option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
      <div className="grid gap-1.5"><Label htmlFor="measurement-metric">Governed metric</Label><select id="measurement-metric" required className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" value={definitionId} onChange={(event)=>{setDefinitionId(event.target.value);setBaselineId('')}}><option value="">Choose metric</option>{definitions.filter((item)=>item.state==='active'&&item.currentVersionId).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div className="grid gap-1.5"><Label htmlFor="measurement-baseline">Baseline observation</Label><select id="measurement-baseline" required disabled={!definitionId} className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" value={baselineId} onChange={(event)=>setBaselineId(event.target.value)}><option value="">Choose baseline</option>{baselineOptions.map((item)=><option key={item.id} value={item.id}>{number(item.value,item.unit)} · ending {date(item.period.end)}</option>)}</select></div>
      <Button className="self-end" type="submit" disabled={busy||!elementId||!definitionId||!baselineId}>Pin baseline</Button>
    </form>}
    {!canManage&&<p className="border-b bg-muted/40 px-4 py-3 text-sm">You have read-only access to measurement lineage and outcomes.</p>}
    <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="overflow-x-auto border-b lg:border-b-0 lg:border-r"><table className="w-full min-w-[720px] text-left text-sm" aria-label="Governed blueprint measurement plans"><thead className="border-b bg-muted/50"><tr><th className="px-3 py-2">Element</th><th className="px-3 py-2">Metric</th><th className="px-3 py-2">Baseline</th><th className="px-3 py-2">Target</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Action</th></tr></thead><tbody>{plans.map((plan)=><tr key={plan.id} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{elementName(plan.element_id)}</td><td className="px-3 py-2">{metricName(plan.metric_definition_id)}</td><td className="px-3 py-2">{number(plan.baseline_value,plan.baseline_unit)}<span className="block text-xs text-muted-foreground">{date(plan.baseline_period_start)}–{date(plan.baseline_period_end)}</span></td><td className="px-3 py-2">{number(plan.target_value,plan.baseline_unit)}</td><td className="px-3 py-2">{plan.state}</td><td className="px-3 py-2"><Button type="button" size="sm" variant={selectedId===plan.id?'secondary':'outline'} onClick={()=>setSelectedId(plan.id)}>View</Button></td></tr>)}</tbody></table>{plans.length===0&&<p className="p-4 text-sm text-muted-foreground">No governed baselines are pinned to this blueprint version.</p>}</div>
      <div className="min-w-0 p-4">{selected?<><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{elementName(selected.element_id)}</h3><p className="mt-1 text-xs text-muted-foreground">Metric version {selected.metric_definition_version_id} · revision {selected.revision}</p></div>{canManage&&selected.state==='active'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void run(async()=>{await closeJourneyBlueprintMeasurement(selected)})}>Close</Button>}</div>
        {canManage&&selected.state==='active'&&<form className="mt-4 grid gap-2 border-y py-4" onSubmit={(event)=>void record(event)}><Label htmlFor="measurement-after">Comparable after observation</Label><select id="measurement-after" required className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" value={afterId} onChange={(event)=>setAfterId(event.target.value)}><option value="">Choose later period</option>{afterOptions.map((item)=><option key={item.id} value={item.id}>{number(item.value,item.unit)} · ending {date(item.period.end)}</option>)}</select><Button type="submit" size="sm" disabled={busy||!afterId}>Record outcome</Button></form>}
        <div className="mt-4 space-y-3"><h3 className="text-sm font-semibold">Outcome history</h3>{outcomes.map((outcome)=><article key={outcome.id} className="border-t pt-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{number(outcome.after_value,selected.baseline_unit)}</span><span>{outcome.absolute_delta>=0?'+':''}{number(outcome.absolute_delta,selected.baseline_unit)}</span></div><p className="mt-1 text-xs text-muted-foreground">After period {date(outcome.after_period_start)}–{date(outcome.after_period_end)}</p><p className="mt-1 text-xs">Descriptive comparison only; no causal claim.</p></article>)}{outcomes.length===0&&<p className="text-sm text-muted-foreground">No comparable after observation has been recorded.</p>}</div>
      </>:<p className="text-sm text-muted-foreground">Choose a measurement plan to inspect its pinned lineage and outcomes.</p>}</div>
    </div>
  </section>;
}
