'use client';
import { useEffect, useId } from 'react';
import { Alert, Box, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useCompetencyBootstrap, LoadingCompetency, CompetencyFailure } from '../CompetencyPage';
export interface CompetencyRoleSelectionProps {
    cycleId: string;
    onCycleChange: (cycleId: string) => void;
    onCycleRevisionChange: (revision: number) => void;
    roleVersionByParticipant: Record<string, string>;
    onRoleChange: (participantId: string, versionId: string) => void;
    participants: Array<{
        userId: string;
        name: string;
    }>;
    disabled?: boolean;
    cvRequested?: boolean;
    onCvRequestedChange?: (requested: boolean) => void;
}
export default function CompetencyRoleSelection({ cycleId, onCycleChange, onCycleRevisionChange, roleVersionByParticipant, onRoleChange, participants, disabled = false, cvRequested = false, onCvRequestedChange }: CompetencyRoleSelectionProps) {
    const cvHelpId = useId();
    const bootstrap = useCompetencyBootstrap();
    const cycle = bootstrap.data?.cycles?.find(c => c.id === cycleId);
    const cycleRevision = cycle?.revision;
    const roles = (bootstrap.data?.roles || []).filter(r => !cycle || cycle.roleVersionIds.includes(r.versionId));
    useEffect(() => { if (cycleRevision !== undefined)
        onCycleRevisionChange(cycleRevision); }, [cycleRevision, onCycleRevisionChange]);
    if (bootstrap.isLoading)
        return <LoadingCompetency />;
    if (bootstrap.error)
        return <CompetencyFailure error={bootstrap.error} retry={() => void bootstrap.mutate()}/>;
    return <Stack gap={2}><Typography variant="h6">Assessment roles</Typography><Typography variant="body2" sx={{ color: 'var(--suite-muted)' }}>Choose the published competency cycle and the work expectations for each person. The selected versions are preserved for this appraisal.</Typography><TextField select label="Competency assessment cycle" required value={cycleId} disabled={disabled} onChange={e => { onCycleChange(e.target.value); const selected = bootstrap.data?.cycles?.find(c => c.id === e.target.value); if (selected)
        onCycleRevisionChange(selected.revision); }}>{bootstrap.data?.cycles?.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</TextField>{!bootstrap.data?.cycles?.length && <Alert severity="info">Publish a competency assessment cycle before selecting assessment roles.</Alert>}{cycle && participants.map(person => <Box key={person.userId} sx={{ border: '1px solid var(--suite-line)', p: 2, borderRadius: 2 }}><Typography fontWeight={650} mb={1}>{person.name}</Typography><TextField fullWidth select required label={`Assessment role for ${person.name}`} value={roleVersionByParticipant[person.userId] || ''} disabled={disabled} onChange={e => onRoleChange(person.userId, e.target.value)} helperText="This occupational role does not change the person’s app permissions.">{roles.map(r => <MenuItem key={r.versionId} value={r.versionId}>{r.name} v{r.version}</MenuItem>)}</TextField></Box>)}{onCvRequestedChange && <Box><FormControlLabel control={<Checkbox checked={cvRequested} disabled={disabled} onChange={event => onCvRequestedChange(event.target.checked)} slotProps={{ input: { 'aria-describedby': cvHelpId } }}/>} label="Request a CV for this appraisal"/><Typography id={cvHelpId} variant="body2" sx={{ color: 'var(--suite-muted)', ml: 4 }}>Employees can upload a current CV as optional evidence for the selected role. A missing CV does not block submission.</Typography></Box>}</Stack>;
}
