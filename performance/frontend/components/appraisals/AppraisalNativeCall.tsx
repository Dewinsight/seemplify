'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Avatar, Box, Button, Checkbox, Chip, CircularProgress, Divider, FormControlLabel, Stack, Typography } from '@mui/material';
import { CallEndOutlined, DownloadOutlined, FiberManualRecord, MicNoneOutlined, MicOffOutlined, ReplayOutlined, ShieldOutlined, StopRounded, VideocamOffOutlined, VideocamOutlined, VolumeUpOutlined } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import api from '@/lib/api';

const message = (error: unknown) => {
  const name = (error as Error)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Microphone or camera access is blocked. Allow access in your browser’s site settings, then join again. You can turn off “Join with camera on” for an audio-only call.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone or camera was found. Connect a microphone, or turn off “Join with camera on” if you do not have a camera, then join again.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'Your microphone or camera is unavailable. Close any other app using it, then join again. You can also try joining with your camera off.';
  return (error as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error || (error as Error)?.message || 'The call could not connect. Check your internet connection and try again.';
};
type State = { peer: string | null; recording: boolean; offer?: Signal; answer?: Signal };
type Signal = { sender: string; target: string; description: RTCSessionDescriptionInit };
type Session = { peerId: string; role: 'manager' | 'employee'; iceServers: RTCIceServer[] };

export default function AppraisalNativeCall({ base, record, recorded, onSaved, participantName = 'Your participant', ownName = 'You' }: { base: string; record: boolean; recorded?: boolean; onSaved: () => void; participantName?: string; ownName?: string }) {
  const [consent, setConsent] = useState(false); const [joined, setJoined] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [status, setStatus] = useState(''); const [recording, setRecording] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false); const [mic, setMic] = useState(true); const [camera, setCamera] = useState(true);
  const [savedBlob, setSavedBlob] = useState<Blob | null>(null); const [recordingNotice, setRecordingNotice] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const localVideo = useRef<HTMLVideoElement>(null); const remoteVideo = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null); const peer = useRef<RTCPeerConnection | null>(null); const session = useRef<Session | null>(null);
  const recorder = useRef<MediaRecorder | null>(null); const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true); const pending = useRef(false); const remoteId = useRef(''); const negotiation = useRef('');
  const unsaved = useRef(false); const recordingCleanup = useRef<(() => void) | null>(null);
  const leave = async () => {
    if (recorder.current?.state === 'recording' || (unsaved.current && !downloaded)) { setError('Stop and save the recording, or download the unsaved copy, before leaving.'); return; }
    unsaved.current = false; setSavedBlob(null); setDownloaded(false);
    if (timer.current) clearInterval(timer.current); timer.current = null;
    peer.current?.close(); peer.current = null; media.current?.getTracks().forEach(track => track.stop()); media.current = null;
    const current = session.current; session.current = null;
    if (current) await api.post(`${base}/leave`, { peerId: current.peerId }).catch(() => {});
    setJoined(false); setRemoteReady(false); setRemoteHasVideo(false); setRecordingNotice(false); setStatus('You left the call.');
    onSaved();
  };
  useEffect(() => {
    mounted.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (recorder.current?.state === 'recording' || unsaved.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted.current = false; window.removeEventListener('beforeunload', beforeUnload);
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop(); }
      recordingCleanup.current?.(); peer.current?.close(); media.current?.getTracks().forEach(track => track.stop());
      if (session.current) void api.post(`${base}/leave`, { peerId: session.current.peerId }).catch(() => {});
    };
  }, [base]);
  const send = (description: RTCSessionDescriptionInit) => api.post(`${base}/signal`, { peerId: session.current!.peerId, target: remoteId.current, description });
  const gather = (connection: RTCPeerConnection) => new Promise<void>(resolve => {
    if (connection.iceGatheringState === 'complete') return resolve();
    const timeout = setTimeout(done, 8000);
    function done() { clearTimeout(timeout); connection.removeEventListener('icegatheringstatechange', check); resolve(); }
    function check() { if (connection.iceGatheringState === 'complete') done(); }
    connection.addEventListener('icegatheringstatechange', check);
  });
  const connect = () => {
    peer.current?.close(); const connection = new RTCPeerConnection({ iceServers: session.current!.iceServers }); peer.current = connection;
    media.current!.getTracks().forEach(track => connection.addTrack(track, media.current!));
    connection.ontrack = event => { if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0]; setRemoteHasVideo(event.streams[0].getVideoTracks().length > 0); };
    connection.onconnectionstatechange = () => {
      if (!mounted.current || peer.current !== connection) return;
      setStatus(connection.connectionState === 'connected' ? `Connected to ${participantName}.` : ['failed', 'disconnected'].includes(connection.connectionState) ? 'The call connection was interrupted. Check your internet connection. If it does not recover, save any recording, then leave and rejoin.' : 'Connecting your call…');
      setRemoteReady(connection.connectionState === 'connected');
      if (['failed', 'disconnected', 'closed'].includes(connection.connectionState) && recorder.current?.state === 'recording') recorder.current.stop();
    };
    return connection;
  };
  const poll = async () => {
    if (pending.current || !session.current) return; pending.current = true;
    try {
      const current = session.current; const state: State = (await api.get(`${base}/state`, { params: { peerId: current.peerId } })).data;
      if (!mounted.current || session.current !== current) return;
      setRecordingNotice(state.recording);
      if (!state.peer) {
        if (remoteId.current) { peer.current?.close(); peer.current = null; setRemoteReady(false); if (recorder.current?.state === 'recording') recorder.current.stop(); }
        remoteId.current = ''; negotiation.current = ''; setStatus(`Waiting for ${participantName} to join. They need to open this appraisal and select “Join in-app call”.`); return;
      }
      if (state.peer !== remoteId.current) { remoteId.current = state.peer; negotiation.current = ''; connect(); }
      const connection = peer.current || connect();
      if (current.role === 'manager' && !negotiation.current) {
        negotiation.current = state.peer; await connection.setLocalDescription(await connection.createOffer()); await gather(connection); await send(connection.localDescription!.toJSON());
      } else if (current.role === 'employee' && state.offer?.target === current.peerId && state.offer.sender === state.peer && negotiation.current !== state.offer.description.sdp) {
        negotiation.current = state.offer.description.sdp || ''; await connection.setRemoteDescription(state.offer.description); await connection.setLocalDescription(await connection.createAnswer()); await gather(connection); await send(connection.localDescription!.toJSON());
      } else if (current.role === 'manager' && state.answer?.target === current.peerId && state.answer.sender === state.peer && connection.signalingState === 'have-local-offer') await connection.setRemoteDescription(state.answer.description);
    } catch (error) { if (mounted.current) setError(message(error)); }
    finally { pending.current = false; }
  };
  const join = async () => {
    setBusy(true); setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Use a current Chrome, Edge, Firefox or Safari browser on HTTPS for in-app calls.');
      const result: Session = (await api.post(`${base}/join`, { peerId: crypto.randomUUID(), consent })).data;
      session.current = result;
      media.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: camera });
      setMic(true);
      setJoined(true); setStatus('Waiting for the other appraisal participant…');
      if (localVideo.current) localVideo.current.srcObject = media.current;
      timer.current = setInterval(() => void poll(), 2000); void poll();
    } catch (error) {
      media.current?.getTracks().forEach(track => track.stop());
      if (session.current) await api.post(`${base}/leave`, { peerId: session.current.peerId }).catch(() => {}); session.current = null;
      setError(message(error));
    } finally { setBusy(false); }
  };
  const upload = async (blob: Blob) => {
    setBusy(true); setError(''); setStatus('Saving recording. Keep this page open…');
    try {
      const data = new FormData(); data.append('recording', blob, blob.type.includes('mp4') ? 'call.mp4' : 'call.webm');
      await api.post(`${base}/upload`, data, { params: { peerId: session.current!.peerId }, headers: { 'Content-Type': undefined }, timeout: 180000 });
      unsaved.current = false; setSavedBlob(null); setDownloaded(false); setStatus('Recording saved. Transcription and ChatGPT notes will appear after processing.'); onSaved();
    } catch (error) { setError(message(error)); setSavedBlob(blob); setStatus('Recording is still in this browser. Retry saving or download a copy before leaving.'); }
    finally { setBusy(false); }
  };
  const startRecording = async () => {
    setBusy(true); setError('');
    try {
      const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('This browser cannot record the call. Use Chrome or Edge.');
      if (!remoteReady || !remoteVideo.current?.srcObject) throw new Error('Wait for both participants to connect.');
      const audio = new AudioContext(); await audio.resume(); const mixed = audio.createMediaStreamDestination();
      audio.createMediaStreamSource(media.current!).connect(mixed); audio.createMediaStreamSource(remoteVideo.current.srcObject as MediaStream).connect(mixed);
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 270; const context = canvas.getContext('2d')!;
      const draw = () => { context.fillStyle = '#111827'; context.fillRect(0, 0, 960, 270); if (localVideo.current && localVideo.current.videoWidth > 0 && localVideo.current.readyState >= 2) context.drawImage(localVideo.current, 0, 0, 480, 270); if (remoteVideo.current && remoteVideo.current.videoWidth > 0 && remoteVideo.current.readyState >= 2) context.drawImage(remoteVideo.current, 480, 0, 480, 270); };
      draw(); const drawing = setInterval(draw, 1000 / 12); const video = canvas.captureStream(12);
      const stream = new MediaStream([...video.getVideoTracks(), ...mixed.stream.getAudioTracks()]);
      const activeRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 128000, audioBitsPerSecond: 48000 });
      let chunks: Blob[] = []; let bytes = 0;
      const limit = setTimeout(() => { if (activeRecorder.state === 'recording') activeRecorder.stop(); }, 30 * 60000);
      const clean = () => { clearTimeout(limit); clearInterval(drawing); video.getTracks().forEach(track => track.stop()); void audio.close(); recordingCleanup.current = null; };
      recordingCleanup.current = clean;
      activeRecorder.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); bytes += event.data.size; if (bytes > 45 * 1024 * 1024 && activeRecorder.state === 'recording') activeRecorder.stop(); } };
      activeRecorder.onstop = () => { clean(); const blob = new Blob(chunks, { type: mimeType.split(';')[0] }); chunks = []; setRecording(false); unsaved.current = true; setSavedBlob(blob); void api.post(`${base}/stop`, { peerId: session.current?.peerId }).catch(() => {}); void upload(blob); };
      try { await api.post(`${base}/record`, { peerId: session.current!.peerId }); } catch (error) { clean(); throw error; }
      recorder.current = activeRecorder; activeRecorder.start(1000); setRecording(true); unsaved.current = true; setStatus('Recording both participants. Stop and save before leaving.'); onSaved();
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  const download = () => { if (!savedBlob) return; const url = URL.createObjectURL(savedBlob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = savedBlob.type.includes('mp4') ? 'unsaved-appraisal-call.mp4' : 'unsaved-appraisal-call.webm'; anchor.click(); setDownloaded(true); setTimeout(() => URL.revokeObjectURL(url), 10000); };
  const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const recordingActive = joined && (recording || recordingNotice);
  const tileStyle = { position: 'relative', aspectRatio: '16 / 10', minWidth: 0, overflow: 'hidden', borderRadius: 2, bgcolor: 'grey.900', color: '#fff' } as const;
  const videoStyle = { width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 } as const;
  const overlayStyle = { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, pb: 4, bgcolor: 'grey.900' } as const;
  const nameStyle = { position: 'absolute', bottom: 12, left: 12, maxWidth: 'calc(100% - 24px)', px: 1.25, py: .5, borderRadius: 1, bgcolor: 'rgba(0,0,0,.65)', color: '#fff', fontWeight: 500, overflowWrap: 'anywhere' } as const;
  return <Box component="section" aria-label="In-app one-on-one" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
    <Stack spacing={2.5} sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1.5} flexWrap="wrap">
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box sx={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 1.5, bgcolor: theme => alpha(theme.palette.primary.main, .09), color: 'primary.main' }}><VideocamOutlined /></Box>
          <Box><Typography component="h3" variant="subtitle1" fontWeight={600}>In-app one-on-one</Typography><Typography variant="body2" color="text.secondary">{participantName === 'Your participant' ? 'Your appraisal conversation' : `With ${participantName}`}</Typography></Box>
        </Stack>
        <Chip size="small" variant="outlined" color={recordingActive ? 'error' : remoteReady ? 'success' : 'default'} icon={recordingActive ? <FiberManualRecord sx={{ fontSize: '12px !important' }} /> : <ShieldOutlined />} label={recordingActive ? 'Recording' : remoteReady ? 'Connected' : joined ? 'Waiting for participant' : 'Private call'} />
      </Stack>
      {error && <Alert severity="error" role="alert">{error}</Alert>}
      {status && !recordingActive && <Typography role="status" aria-live="polite" variant="body2" color="text.secondary">{status}</Typography>}
      {recordingActive && <Alert severity="warning">Recording is in progress. Both participants’ audio and video may be captured.</Alert>}
      <Box sx={{ display: joined ? 'grid' : 'none', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
        <Box sx={tileStyle}>
          <Box component="video" ref={localVideo} autoPlay playsInline muted aria-label="Your camera preview" sx={{ ...videoStyle, transform: 'scaleX(-1)' }} />
          {!camera && <Box sx={overlayStyle}><Avatar sx={{ width: { xs: 48, sm: 64 }, height: { xs: 48, sm: 64 }, background: theme => theme.palette.primary.main, color: 'primary.contrastText', fontSize: 24 }}>{initials(ownName)}</Avatar><Stack direction="row" gap={.75} alignItems="center"><VideocamOffOutlined fontSize="small" /><Typography variant="body2">Camera off</Typography></Stack></Box>}
          <Typography variant="caption" sx={nameStyle}>{ownName}{ownName !== 'You' ? ' (you)' : ''}{!mic ? ' · Muted' : ''}</Typography>
        </Box>
        <Box sx={tileStyle}>
          <Box component="video" ref={remoteVideo} autoPlay playsInline aria-label="Other participant" sx={videoStyle} />
          {(!remoteReady || !remoteHasVideo) && <Box sx={overlayStyle}><Avatar sx={{ width: { xs: 48, sm: 64 }, height: { xs: 48, sm: 64 }, background: theme => theme.palette.grey[700], color: 'common.white', fontSize: 24 }}>{initials(participantName)}</Avatar><Typography variant="body2">{remoteReady ? 'Camera off' : 'Waiting to connect…'}</Typography></Box>}
          <Typography variant="caption" sx={nameStyle}>{participantName}</Typography>
        </Box>
      </Box>
      {!joined && <Stack spacing={2}>
        <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: theme => alpha(theme.palette.primary.main, .04), border: 1, borderColor: 'divider' }}>
          <Typography fontWeight={600} variant="body2">{record ? 'Recording enabled for this call' : 'Recording is off for this call.'}</Typography>
          <Typography variant="body2" color="text.secondary" mt={.5}>{record ? 'Both participants must agree before recording starts. The recording, transcript and meeting notes stay with this meeting.' : 'Join for a private conversation. The organizer can add agreed notes afterwards.'}</Typography>
        </Box>
        <FormControlLabel sx={{ m: 0 }} control={<Checkbox checked={camera} onChange={(_, checked) => setCamera(checked)} />} label="Join with camera on" />
        <Typography variant="body2" color="text.secondary">Your browser will ask for microphone{camera ? ' and camera' : ''} access when you join.{record ? ' Recording starts only when the reviewer selects “Start agreed recording”.' : ' This call will not be recorded.'}</Typography>
        {record && <FormControlLabel sx={{ m: 0, alignItems: 'flex-start', '& .MuiCheckbox-root': { pt: 0 }, '& .MuiFormControlLabel-label': { typography: 'body2' } }} control={<Checkbox checked={consent} onChange={(_, checked) => setConsent(checked)} />} label="I agree to this call being recorded and transcribed, and shared with people who can access this appraisal." />}
        {record && !consent && <Typography variant="body2" color="text.secondary">To join this recorded call, confirm your agreement above. If you prefer an unrecorded call, ask your reviewer to arrange one.</Typography>}
        <Button variant="contained" startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <VideocamOutlined />} sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' }, minHeight: 44, px: 3 }} disabled={busy || (record && !consent)} onClick={join}>Join in-app call</Button>
      </Stack>}
      {joined && <>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ '& .MuiButton-root': { minHeight: 44, flexGrow: { xs: 1, sm: 0 } } }}>
          <Button variant="outlined" color={mic ? 'inherit' : 'primary'} aria-label={mic ? 'Mute microphone' : 'Unmute microphone'} aria-pressed={!mic} startIcon={mic ? <MicNoneOutlined /> : <MicOffOutlined />} onClick={() => { media.current?.getAudioTracks().forEach(track => { track.enabled = !mic; }); setMic(!mic); }}><Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{mic ? 'Mute microphone' : 'Unmute microphone'}</Box><Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{mic ? 'Mute' : 'Unmute'}</Box></Button>
          <Button variant="outlined" color="inherit" aria-label={camera ? 'Turn camera off' : 'Turn camera on'} aria-pressed={!camera} startIcon={camera ? <VideocamOutlined /> : <VideocamOffOutlined />} disabled={!media.current?.getVideoTracks().length} onClick={() => { media.current?.getVideoTracks().forEach(track => { track.enabled = !camera; }); setCamera(!camera); }}><Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{camera ? 'Turn camera off' : 'Turn camera on'}</Box><Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{camera ? 'Hide video' : 'Show video'}</Box></Button>
          <Button color="inherit" startIcon={<VolumeUpOutlined />} onClick={() => { void remoteVideo.current?.play().catch(() => setError('Audio playback is blocked by your browser. Check this site’s sound permissions.')); }}>Enable call audio</Button>
          <Button variant="outlined" color="error" startIcon={<CallEndOutlined />} sx={{ ml: { sm: 'auto' } }} disabled={busy || recording || (!!savedBlob && !downloaded)} onClick={leave}>{savedBlob && downloaded ? 'Leave with downloaded copy' : 'Leave call'}</Button>
        </Stack>
        {!media.current?.getVideoTracks().length && <Typography variant="caption" color="text.secondary">To enable your camera, leave and rejoin with “Join with camera on” selected.</Typography>}
        {record && <><Divider /><Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" gap={1.5}>
          <Typography variant="body2" color="text.secondary">{recordingActive ? recording ? 'Recording both participants. Stop and save before leaving.' : 'Your reviewer is recording this conversation.' : busy && savedBlob ? 'Saving your recording. Keep this page open…' : recorded ? 'Your recording is saved with this appraisal.' : 'Recording starts only when both participants are connected.'}</Typography>
          {record && !recorded && session.current?.role === 'manager' && !recording && !savedBlob && <Button variant="contained" startIcon={<FiberManualRecord />} sx={{ flexShrink: 0, minHeight: 44 }} disabled={busy || !remoteReady} onClick={startRecording}>Start agreed recording</Button>}
          {recording && <Button variant="contained" color="error" startIcon={<StopRounded />} sx={{ flexShrink: 0, minHeight: 44 }} disabled={busy} onClick={() => recorder.current?.stop()}>Stop and save recording</Button>}
        </Stack></>}
      </>}
      {savedBlob && !busy && <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}><Button variant="contained" startIcon={<ReplayOutlined />} onClick={() => upload(savedBlob)}>Retry saving recording</Button><Button startIcon={<DownloadOutlined />} onClick={download}>Download unsaved copy</Button></Stack>}
      {savedBlob && downloaded && <Alert severity="warning">Check that the download succeeded before leaving. This copy has not been saved to Seemplify; leaving will keep only your downloaded file.</Alert>}
      {joined && record && <Typography variant="caption" color="text.secondary">Keep this page open until saving finishes. Each call supports one recording of up to 30 minutes or 50 MB. Add another call step for a longer discussion.</Typography>}
    </Stack>
  </Box>;
}
