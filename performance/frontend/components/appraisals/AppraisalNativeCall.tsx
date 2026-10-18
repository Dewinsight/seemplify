'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import api from '@/lib/api';

const message = (error: unknown) => (error as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error || (error as Error)?.message || 'Call failed. Please retry.';
type State = { peer: string | null; recording: boolean; offer?: Signal; answer?: Signal };
type Signal = { sender: string; target: string; description: RTCSessionDescriptionInit };
type Session = { peerId: string; role: 'manager' | 'employee'; iceServers: RTCIceServer[] };

export default function AppraisalNativeCall({ base, record, recorded, onSaved }: { base: string; record: boolean; recorded?: boolean; onSaved: () => void }) {
  const [consent, setConsent] = useState(false); const [joined, setJoined] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [status, setStatus] = useState(''); const [recording, setRecording] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false); const [mic, setMic] = useState(true); const [camera, setCamera] = useState(true);
  const [savedBlob, setSavedBlob] = useState<Blob | null>(null); const [recordingNotice, setRecordingNotice] = useState(false);
  const localVideo = useRef<HTMLVideoElement>(null); const remoteVideo = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null); const peer = useRef<RTCPeerConnection | null>(null); const session = useRef<Session | null>(null);
  const recorder = useRef<MediaRecorder | null>(null); const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true); const pending = useRef(false); const remoteId = useRef(''); const negotiation = useRef('');
  const unsaved = useRef(false); const recordingCleanup = useRef<(() => void) | null>(null);
  const leave = async () => {
    if (recorder.current?.state === 'recording' || unsaved.current) { setError('Stop and save the recording, or download the unsaved copy, before leaving.'); return; }
    if (timer.current) clearInterval(timer.current); timer.current = null;
    peer.current?.close(); peer.current = null; media.current?.getTracks().forEach(track => track.stop()); media.current = null;
    const current = session.current; session.current = null;
    if (current) await api.post(`${base}/leave`, { peerId: current.peerId }).catch(() => {});
    setJoined(false); setRemoteReady(false); setStatus('You left the call.');
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
    connection.ontrack = event => { if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0]; };
    connection.onconnectionstatechange = () => {
      if (!mounted.current || peer.current !== connection) return;
      setStatus(connection.connectionState === 'connected' ? 'Connected to your appraisal participant.' : `Call ${connection.connectionState}.`);
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
        remoteId.current = ''; negotiation.current = ''; setStatus('Waiting for the other appraisal participant…'); return;
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
      unsaved.current = false; setSavedBlob(null); setStatus('Recording saved. Transcription and ChatGPT notes will appear after processing.'); onSaved();
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
      const draw = () => { context.fillStyle = '#111827'; context.fillRect(0, 0, 960, 270); if (localVideo.current?.readyState) context.drawImage(localVideo.current, 0, 0, 480, 270); if (remoteVideo.current?.readyState) context.drawImage(remoteVideo.current, 480, 0, 480, 270); };
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
  const download = () => { if (!savedBlob) return; const url = URL.createObjectURL(savedBlob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'unsaved-appraisal-call.webm'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); };
  return <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
    <Stack spacing={2}>
      <Typography component="h3" variant="subtitle1" fontWeight={600}>In-app one-on-one</Typography>
      <Typography variant="body2" color="text.secondary">Only the assigned reviewer and employee can join. {record ? 'The reviewer can record both participants after both agree. Recordings are saved privately with this appraisal. Speech is transcribed by Seemplify’s managed Azure Speech service; ChatGPT creates the meeting notes.' : 'Recording is off for this call.'}</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {status && <Typography role="status" variant="body2">{status}</Typography>}
      {(recording || recordingNotice) && <Alert severity="warning">Recording is in progress. Both participants’ audio and video may be captured.</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ display: joined ? 'flex' : 'none' }}>
        <Box component="video" ref={localVideo} autoPlay playsInline muted aria-label="Your camera preview" sx={{ width: { xs: '100%', sm: '50%' }, minWidth: 0, bgcolor: 'background.default', borderRadius: 1 }} />
        <Box component="video" ref={remoteVideo} autoPlay playsInline aria-label="Other participant" sx={{ width: { xs: '100%', sm: '50%' }, minWidth: 0, bgcolor: 'background.default', borderRadius: 1 }} />
      </Stack>
      {!joined && <>
        <FormControlLabel control={<Checkbox checked={camera} onChange={(_, checked) => setCamera(checked)} />} label="Join with camera on" />
        {record && <FormControlLabel control={<Checkbox checked={consent} onChange={(_, checked) => setConsent(checked)} />} label="I agree to this call being recorded and transcribed, and shared with people who can access this appraisal." />}
        <Button variant="contained" disabled={busy || (record && !consent)} onClick={join}>Join in-app call</Button>
      </>}
      {joined && <Stack direction="row" flexWrap="wrap" gap={1}>
        <Button variant="outlined" onClick={() => { media.current?.getAudioTracks().forEach(track => { track.enabled = !mic; }); setMic(!mic); }}>{mic ? 'Mute microphone' : 'Unmute microphone'}</Button>
        <Button variant="outlined" disabled={!media.current?.getVideoTracks().length} onClick={() => { media.current?.getVideoTracks().forEach(track => { track.enabled = !camera; }); setCamera(!camera); }}>{camera ? 'Turn camera off' : 'Turn camera on'}</Button>
        <Button onClick={() => { void remoteVideo.current?.play().catch(() => setError('Audio playback is blocked by your browser. Check this site’s sound permissions.')); }}>Enable call audio</Button>
        {record && !recorded && session.current?.role === 'manager' && !recording && !savedBlob && <Button variant="contained" disabled={busy || !remoteReady} onClick={startRecording}>Start agreed recording</Button>}
        {recording && <Button variant="contained" color="error" disabled={busy} onClick={() => recorder.current?.stop()}>Stop and save recording</Button>}
        <Button color="error" disabled={busy || recording || !!savedBlob} onClick={leave}>Leave call</Button>
      </Stack>}
      {savedBlob && !busy && <Stack direction="row" flexWrap="wrap" gap={1}><Button variant="contained" onClick={() => upload(savedBlob)}>Retry saving recording</Button><Button onClick={download}>Download unsaved copy</Button></Stack>}
      {joined && record && <Typography variant="caption" color="text.secondary">Keep this page open until saving finishes. Each call supports one recording of up to 30 minutes or 50 MB. Add another call step for a longer discussion.</Typography>}
    </Stack>
  </Box>;
}
