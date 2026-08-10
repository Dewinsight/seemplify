import { useEffect,useState } from 'react';
import { appendJourneyEventMappingVersion,createJourneyEventMapping,listJourneyEventMappings,retireJourneyEventMapping,
  type JourneyEventMapping,type JourneyEventMappingInput } from '../../lib/journeyEventIntelligence';

const empty:JourneyEventMappingInput={sourceId:'',environment:'production',eventName:'',schemaVersionId:'',journeyDefinitionId:'',journeyMapVersionId:'',
  stageKey:'',stageRuleVersionId:'',metricDefinitionId:'',metricDefinitionVersionId:'',metricUnit:'count',valueMode:'count',constantValue:null,
  numericPropertyPath:null,dimensionKeys:['channel','environment'],consentRequirement:'granted_or_not_required',purpose:'analytics',retentionDays:30};
const label=(value:string)=>value.replaceAll('_',' ');
export function JourneyEventMappingPanel({canManage}:{canManage:boolean}){const [rows,setRows]=useState<JourneyEventMapping[]>([]);const [form,setForm]=useState(empty);
  const [editing,setEditing]=useState<JourneyEventMapping|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const load=async()=>{try{setRows(await listJourneyEventMappings());}catch(reason){setError(reason instanceof Error?reason.message:'Mappings could not be loaded.');}};
  useEffect(()=>{void load();},[]);const field=(key:keyof JourneyEventMappingInput,value:unknown)=>setForm(current=>({...current,[key]:value}));
  const edit=(row:JourneyEventMapping)=>{setEditing(row);setForm({sourceId:row.sourceId,environment:row.environment as any,eventName:row.eventName,
    schemaVersionId:row.schemaVersionId||'',journeyDefinitionId:row.journeyDefinitionId||'',journeyMapVersionId:row.journeyMapVersionId||'',stageKey:row.stageKey||'',
    stageRuleVersionId:row.stageRuleVersionId||'',metricDefinitionId:row.metricDefinitionId||'',metricDefinitionVersionId:row.metricDefinitionVersionId||'',
    metricUnit:(row.metricUnit||'count') as any,valueMode:(row.valueMode||'count') as any,constantValue:row.constantValue,numericPropertyPath:row.numericPropertyPath,
    dimensionKeys:row.dimensionKeys as any,consentRequirement:(row.consentRequirement||'granted_or_not_required') as any,purpose:(row.purpose||'analytics') as any,retentionDays:row.retentionDays||30});};
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setBusy(true);setError('');try{if(editing)await appendJourneyEventMappingVersion(editing.id,editing.revision,form);
    else await createJourneyEventMapping(form);setEditing(null);setForm(empty);await load();}catch(reason){setError(reason instanceof Error?reason.message:'Mapping could not be saved.');}finally{setBusy(false);}};
  return <section className="border bg-card" aria-labelledby="event-mappings-heading" data-testid="journey-event-mappings">
    <div className="border-b px-4 py-3"><h2 id="event-mappings-heading" className="text-sm font-semibold">Event mappings</h2>
      <p className="mt-1 text-sm text-muted-foreground">Published event schemas and stage rules can produce governed stage measures. IDs and hashes below are immutable lineage, not customer event content.</p></div>
    {error&&<p className="border-b px-4 py-3 text-sm text-destructive" role="alert">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-muted-foreground">
      <th className="px-4 py-2 font-medium">Event</th><th className="px-4 py-2 font-medium">Stage</th><th className="px-4 py-2 font-medium">Metric</th>
      <th className="px-4 py-2 font-medium">Version</th><th className="px-4 py-2 font-medium">State</th>{canManage&&<th className="px-4 py-2 font-medium">Actions</th>}</tr></thead>
      <tbody>{rows.map(row=><tr className="border-b last:border-0" key={row.id}><td className="px-4 py-3"><div>{row.eventName}</div><div className="text-xs text-muted-foreground">{row.sourceId} · {row.environment}</div></td>
        <td className="px-4 py-3"><div>{row.stageKey}</div><div className="font-mono text-xs text-muted-foreground">rule {row.stageRuleVersionId}</div></td>
        <td className="px-4 py-3"><div>{row.metricDefinitionId}</div><div className="text-xs text-muted-foreground">{label(row.valueMode||'unknown')} · {row.metricUnit}</div></td>
        <td className="px-4 py-3"><div>v{row.versionNumber}</div><div className="font-mono text-xs text-muted-foreground">{row.contentSha256?.slice(0,12)}</div></td><td className="px-4 py-3">{row.state}</td>
        {canManage&&<td className="px-4 py-3"><div className="flex gap-2"><button className="h-8 border px-3" onClick={()=>edit(row)}>New version</button>{row.state==='active'&&<button className="h-8 border px-3" onClick={async()=>{setBusy(true);try{await retireJourneyEventMapping(row.id,row.revision);await load();}finally{setBusy(false);}}}>Retire</button>}</div></td>}</tr>)}
        {!rows.length&&<tr><td className="px-4 py-6 text-muted-foreground" colSpan={canManage?6:5}>No journey event mappings are configured.</td></tr>}</tbody></table></div>
    {canManage&&<form className="border-t p-4" onSubmit={submit}><h3 className="text-sm font-semibold">{editing?'Append mapping version':'Add event mapping'}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([['sourceId','Source ID'],['eventName','Event name'],['schemaVersionId','Published schema version ID'],['journeyDefinitionId','Journey definition ID'],['journeyMapVersionId','Journey map version ID'],['stageKey','Stage key'],['stageRuleVersionId','Published stage rule version ID'],['metricDefinitionId','Metric definition ID'],['metricDefinitionVersionId','Journey-event metric version ID']] as const).map(([key,title])=><label className="grid gap-1 text-sm" key={key}>{title}<input className="h-9 border bg-background px-3" required value={String(form[key]||'')} disabled={Boolean(editing)&&['sourceId','eventName'].includes(key)} onChange={event=>field(key,event.target.value)}/></label>)}
        <label className="grid gap-1 text-sm">Environment<select className="h-9 border bg-background px-3" value={form.environment} disabled={Boolean(editing)} onChange={event=>field('environment',event.target.value)}>{['development','staging','production'].map(value=><option key={value}>{value}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Value mode<select className="h-9 border bg-background px-3" value={form.valueMode} onChange={event=>{const value=event.target.value as JourneyEventMappingInput['valueMode'];setForm(current=>({...current,valueMode:value,
          constantValue:value==='constant'?current.constantValue:null,numericPropertyPath:value==='numeric_property'?current.numericPropertyPath:null}));}}>{['count','constant','numeric_property','elapsed_since_prior'].map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Metric unit<select className="h-9 border bg-background px-3" value={form.metricUnit} onChange={event=>field('metricUnit',event.target.value)}>{['score','percent','count','seconds','minutes','hours','rate','index','currency','unknown'].map(value=><option key={value}>{value}</option>)}</select></label>
        {form.valueMode==='constant'&&<label className="grid gap-1 text-sm">Constant value<input type="number" className="h-9 border bg-background px-3" required value={form.constantValue??''} onChange={event=>field('constantValue',Number(event.target.value))}/></label>}
        {form.valueMode==='numeric_property'&&<label className="grid gap-1 text-sm">Numeric property path<input className="h-9 border bg-background px-3" required value={form.numericPropertyPath||''} onChange={event=>field('numericPropertyPath',event.target.value)}/></label>}
        <label className="grid gap-1 text-sm">Purpose<select className="h-9 border bg-background px-3" value={form.purpose} onChange={event=>field('purpose',event.target.value)}>{['service_improvement','analytics','research'].map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Retention days<input type="number" min={1} max={3650} className="h-9 border bg-background px-3" value={form.retentionDays} onChange={event=>field('retentionDays',Number(event.target.value))}/></label>
      </div><div className="mt-3 flex gap-2"><button className="h-9 border bg-foreground px-4 text-sm text-background" disabled={busy}>{busy?'Saving…':editing?'Append version':'Create mapping'}</button>{editing&&<button type="button" className="h-9 border px-4 text-sm" onClick={()=>{setEditing(null);setForm(empty);}}>Cancel</button>}</div></form>}
  </section>}
