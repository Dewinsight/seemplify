import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Loader2, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { createJourneyExportBrandAsset, createJourneyExportBrandProfile, createJourneyExportBrandVersion,
  journeyExportBrandFonts, listJourneyExportBrands, readJourneyExportBrandAccess, setJourneyExportBrandDefault,
  uploadJourneyExportLogo, type JourneyExportBrandAccess, type JourneyExportBrandCatalog,
  type JourneyExportBrandConfiguration, type JourneyExportBrandFont } from '@/lib/journeyExportBrand';

const defaults:JourneyExportBrandConfiguration={organisationName:'',logoAssetId:null,primaryHex:'#292524',accentHex:'#B45309',
  backgroundHex:'#FFFFFF',textHex:'#1C1917',fontFamily:'Aptos',footerText:'',locale:'en-GB'};
function luminance(colour:string){const values=[1,3,5].map((offset)=>parseInt(colour.slice(offset,offset+2),16)/255)
  .map((value)=>value<=.03928?value/12.92:((value+.055)/1.055)**2.4);return .2126*values[0]+.7152*values[1]+.0722*values[2];}
function contrast(a:string,b:string){const values=[luminance(a),luminance(b)].sort((left,right)=>right-left);return(values[0]+.05)/(values[1]+.05);}
function message(reason:unknown,fallback:string){return reason instanceof Error&&reason.message?reason.message:fallback;}

export function JourneyExportBrandSettings(){const[access,setAccess]=useState<JourneyExportBrandAccess|null>(null),[catalog,setCatalog]=useState<JourneyExportBrandCatalog|null>(null);
  const[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[selectedProfileId,setSelectedProfileId]=useState('');
  const[name,setName]=useState(''),[configuration,setConfiguration]=useState<JourneyExportBrandConfiguration>(defaults),[logoAlt,setLogoAlt]=useState('');
  const selected=useMemo(()=>catalog?.profiles.find((entry)=>entry.profile.id===selectedProfileId)||null,[catalog,selectedProfileId]);
  const activeAssets=catalog?.assets.filter((asset)=>asset.state==='active')||[],defaultEntry=catalog?.profiles.find((entry)=>
    entry.profile.id===catalog.settings.defaultProfileId&&entry.version.version===catalog.settings.defaultProfileVersion)||null;
  const contrastRatio=contrast(configuration.textHex,configuration.backgroundHex),contrastError=contrastRatio<4.5
    ?`Text and background contrast is ${contrastRatio.toFixed(2)}:1. Use at least 4.5:1.`:'';
  const load=useCallback(async()=>{setLoading(true);try{const nextAccess=await readJourneyExportBrandAccess();setAccess(nextAccess);
    if(!nextAccess.canRead){setCatalog(null);return;}const next=await listJourneyExportBrands();setCatalog(next);setSelectedProfileId((current)=>
      next.profiles.some((entry)=>entry.profile.id===current)?current:(next.settings.defaultProfileId||next.profiles[0]?.profile.id||''));setError('');}
    catch(reason){setError(message(reason,'Brand export settings could not be loaded.'));}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(!selected)return;setName(selected.profile.name);setConfiguration({organisationName:selected.version.organisationName,
    logoAssetId:selected.version.logoAssetId,primaryHex:selected.version.primaryHex,accentHex:selected.version.accentHex,
    backgroundHex:selected.version.backgroundHex,textHex:selected.version.textHex,fontFamily:selected.version.fontFamily,
    footerText:selected.version.footerText,locale:selected.version.locale});const asset=catalog?.assets.find((item)=>item.id===selected.version.logoAssetId);setLogoAlt(asset?.altText||'');},[selected,catalog?.assets]);
  const fail=async(reason:unknown,fallback:string)=>{if(reason instanceof ApiError&&reason.status===409){setError(`${reason.message} The latest settings have been reloaded.`);await load();}
    else setError(message(reason,fallback));};
  async function uploadLogo(file:File|null){if(!file)return;if(!['image/png','image/jpeg'].includes(file.type)){setError('Choose a PNG or JPEG logo.');return;}
    if(file.size>5*1024*1024){setError('Logo files must be 5 MB or smaller.');return;}if(!logoAlt.trim()){setError('Add alternative text before uploading the logo.');return;}
    setBusy('upload');try{const upload=await uploadJourneyExportLogo(file),asset=await createJourneyExportBrandAsset(upload.id,logoAlt.trim());
      setCatalog((current)=>current?{...current,assets:[asset,...current.assets.filter((item)=>item.id!==asset.id)]}:current);
      setConfiguration((current)=>({...current,logoAssetId:asset.id}));toast.success('Logo added to this space.');setError('');}
    catch(reason){await fail(reason,'The logo could not be uploaded.');}finally{setBusy('');}}
  async function saveProfile(){if(!catalog||contrastError||!name.trim()||!configuration.organisationName.trim())return;setBusy('save');try{
    const result=selected?await createJourneyExportBrandVersion(selected.profile,configuration):await createJourneyExportBrandProfile({name:name.trim(),...configuration});
    await load();setSelectedProfileId(result.profile.id);toast.success(selected?'Brand profile version created.':'Brand profile created.');setError('');}
    catch(reason){await fail(reason,'The brand profile could not be saved.');}finally{setBusy('');}}
  async function makeDefault(){if(!catalog||!selected)return;setBusy('default');try{await setJourneyExportBrandDefault(catalog,selected.profile.id,selected.version.version);
    await load();toast.success('Default export brand updated.');setError('');}catch(reason){await fail(reason,'The default export brand could not be updated.');}finally{setBusy('');}}
  function newProfile(){setSelectedProfileId('');setName('');setConfiguration(defaults);setLogoAlt('');setError('');}
  if(loading)return <section className="border bg-card p-5" aria-label="Brand export settings" data-testid="journey-export-brand-loading"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Loading brand export settings…</span></section>;
  if(!access?.canRead)return null;
  return <section className="border bg-card" aria-labelledby="journey-export-brand-heading" data-testid="journey-export-brand-settings">
    <div className="flex items-start justify-between gap-3 border-b px-5 py-4"><div className="flex items-start gap-3"><Image className="mt-0.5 h-4 w-4 text-muted-foreground"/><div>
      <h2 id="journey-export-brand-heading" className="text-sm font-semibold">Brand export settings</h2><p className="mt-1 text-xs text-muted-foreground">Applied to journey PDF, PNG and presentation exports.</p></div></div>
      <Button type="button" size="sm" variant="ghost" aria-label="Reload brand export settings" onClick={()=>void load()}><RefreshCw/></Button></div>
    {!catalog?.profiles.length&&!access.canEdit?<p className="p-5 text-sm text-muted-foreground">No export brand has been configured for this space.</p>:
      <div className="grid lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="border-b p-4 lg:border-b-0 lg:border-r"><Label htmlFor="brand-profile-select">Profile</Label><select id="brand-profile-select" value={selectedProfileId}
          className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" onChange={(event)=>setSelectedProfileId(event.currentTarget.value)}>
          {!catalog?.profiles.length&&<option value="">No profiles</option>}{catalog?.profiles.map((entry)=><option key={entry.profile.id} value={entry.profile.id}>{entry.profile.name} · v{entry.version.version}</option>)}</select>
          {access.canEdit&&<Button type="button" size="sm" variant="outline" className="mt-3 w-full" onClick={newProfile}>New profile</Button>}
          <div className="mt-4 border-t pt-3 text-xs"><p className="font-medium">Space default</p><p className="mt-1 text-muted-foreground" data-testid="journey-export-brand-effective">
            {defaultEntry?`${defaultEntry.profile.name}, version ${defaultEntry.version.version}`:'No brand; exports use the standard Seemplify layout.'}</p></div>
        </div>
        {access.canEdit?<div className="p-5"><div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="brand-profile-name">Profile name</Label><Input id="brand-profile-name" value={name} maxLength={120} onChange={(event)=>setName(event.target.value)}/></div>
          <div><Label htmlFor="brand-organisation">Organisation name</Label><Input id="brand-organisation" value={configuration.organisationName} maxLength={160} onChange={(event)=>setConfiguration((current)=>({...current,organisationName:event.target.value}))}/></div>
          <div><Label htmlFor="brand-logo-alt">Logo alternative text</Label><Input id="brand-logo-alt" value={logoAlt} maxLength={300} onChange={(event)=>setLogoAlt(event.target.value)}/></div>
          <div><Label htmlFor="brand-logo">Logo</Label><div className="mt-1 flex gap-2"><select aria-label="Selected brand logo" value={configuration.logoAssetId||''} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
            onChange={(event)=>{const id=event.currentTarget.value||null;setConfiguration((current)=>({...current,logoAssetId:id}));setLogoAlt(activeAssets.find((asset)=>asset.id===id)?.altText||'');}}><option value="">No logo</option>
            {activeAssets.map((asset)=><option key={asset.id} value={asset.id}>{asset.altText} · {asset.width}×{asset.height}</option>)}</select>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium"><Upload className="h-4 w-4"/>{busy==='upload'?'Uploading':'Upload'}<input id="brand-logo" className="sr-only" type="file" accept="image/png,image/jpeg" disabled={Boolean(busy)} onChange={(event)=>void uploadLogo(event.currentTarget.files?.[0]||null)}/></label></div></div>
          {(['primaryHex','accentHex','backgroundHex','textHex'] as const).map((key)=><div key={key}><Label htmlFor={`brand-${key}`}>{key.replace('Hex','').replace(/^./,v=>v.toUpperCase())} colour</Label>
            <div className="mt-1 flex gap-2"><input id={`brand-${key}`} type="color" value={configuration[key]} className="h-9 w-12 border bg-background p-1" onChange={(event)=>setConfiguration((current)=>({...current,[key]:event.target.value.toUpperCase()}))}/>
            <Input aria-label={`${key.replace('Hex','')} colour hex`} value={configuration[key]} maxLength={7} onChange={(event)=>setConfiguration((current)=>({...current,[key]:event.target.value.toUpperCase()}))}/></div></div>)}
          <div><Label htmlFor="brand-font">Font</Label><select id="brand-font" value={configuration.fontFamily} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" onChange={(event)=>setConfiguration((current)=>({...current,fontFamily:event.target.value as JourneyExportBrandFont}))}>{journeyExportBrandFonts.map((font)=><option key={font}>{font}</option>)}</select></div>
          <div><Label htmlFor="brand-locale">Locale</Label><Input id="brand-locale" value={configuration.locale} maxLength={35} onChange={(event)=>setConfiguration((current)=>({...current,locale:event.target.value}))}/></div>
          <div className="sm:col-span-2"><Label htmlFor="brand-footer">Footer text</Label><Input id="brand-footer" value={configuration.footerText} maxLength={300} onChange={(event)=>setConfiguration((current)=>({...current,footerText:event.target.value}))}/></div>
        </div>
        <div className="mt-4 border p-3" style={{backgroundColor:configuration.backgroundHex,color:configuration.textHex,borderColor:configuration.accentHex}} aria-label="Brand export preview"><p className="text-sm font-semibold">{configuration.organisationName||'Organisation name'}</p><p className="mt-1 text-xs">Journey export preview</p></div>
        {contrastError&&<p className="mt-3 text-sm text-destructive" role="alert">{contrastError}</p>}
        <div className="mt-4 flex flex-wrap gap-2"><Button type="button" disabled={Boolean(busy)||Boolean(contrastError)||!name.trim()||!configuration.organisationName.trim()} onClick={()=>void saveProfile()}>
          {busy==='save'&&<Loader2 className="animate-spin"/>}{selected?'Create version':'Create profile'}</Button>
          {selected&&<Button type="button" variant="outline" disabled={Boolean(busy)||Boolean(defaultEntry&&defaultEntry.profile.id===selected.profile.id&&defaultEntry.version.version===selected.version.version)} onClick={()=>void makeDefault()}>
            {busy==='default'&&<Loader2 className="animate-spin"/>}Set as space default</Button>}</div></div>:
          <div className="p-5"><p className="text-sm font-medium">{defaultEntry?.version.organisationName||'Standard export branding'}</p><p className="mt-1 text-sm text-muted-foreground">{defaultEntry?`${defaultEntry.profile.name}, version ${defaultEntry.version.version}.`: 'No space default is configured.'}</p>
            {defaultEntry&&<dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Logo</dt><dd>{defaultEntry.version.logoAssetId?activeAssets.find((asset)=>asset.id===defaultEntry.version.logoAssetId)?.altText||'Configured logo':'No logo'}</dd></div><div><dt className="text-xs text-muted-foreground">Font and locale</dt><dd>{defaultEntry.version.fontFamily} · {defaultEntry.version.locale}</dd></div></dl>}</div>}
      </div>}
    {error&&<p className="border-t px-5 py-3 text-sm text-destructive" role="alert">{error}</p>}
  </section>;
}
