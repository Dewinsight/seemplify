'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, Mail, Moon, MonitorUp, Save } from 'lucide-react';
import { notificationsApi } from '@/lib/api';

function vapidKey(value: string) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw.split('').map(char => char.charCodeAt(0)));
}

export default function NotificationsPage() {
    const [items, setItems] = useState<any[]>([]);
    const [preferences, setPreferences] = useState<any>(null);
    const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
    const [message, setMessage] = useState('');

    const load = async () => {
        const [notifications, settings] = await Promise.all([notificationsApi.list(), notificationsApi.getPreferences()]);
        setItems(notifications.notifications || []);
        setPreferences(settings.preferences);
        setVapidPublicKey(settings.vapidPublicKey);
    };
    useEffect(() => { void load().catch(() => setMessage('Notifications could not be loaded.')); }, []);

    const markAllRead = async () => { await notificationsApi.readAll(); await load(); };
    const markRead = async (item: any) => { if (!item.readAt) await notificationsApi.read(item._id); await load(); };
    const save = async () => { await notificationsApi.savePreferences(preferences); setMessage('Preferences saved.'); };
    const enablePush = async () => {
        if (!vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return setMessage('Browser push is not configured for this environment.');
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return setMessage('Browser permission was not granted. Email and in-app notifications remain available.');
        const registration = await navigator.serviceWorker.register('/push-service-worker.js');
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(vapidPublicKey) });
        await notificationsApi.savePushSubscription(subscription.toJSON());
        const next = { ...preferences, channels: { ...preferences.channels, browserPush: true } };
        setPreferences(next); await notificationsApi.savePreferences(next); setMessage('Browser push enabled.');
    };

    if (!preferences) return <div className="py-20 text-center text-zinc-400">Loading notifications…</div>;
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div><h1 className="text-2xl font-semibold text-white">Notifications</h1><p className="mt-1 text-sm text-zinc-400">Attendance updates, deadlines, warnings and delivery preferences.</p></div>
                <button onClick={markAllRead} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"><CheckCheck className="h-4 w-4" />Mark all read</button>
            </div>
            {message && <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">{message}</div>}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
                    {items.length === 0 ? <div className="p-10 text-center text-sm text-zinc-500">No notifications yet.</div> : items.map(item => (
                        <Link key={item._id} href={item.actionUrl || '/notifications'} onClick={() => void markRead(item)} className={`block border-b border-zinc-800 px-5 py-4 last:border-0 hover:bg-zinc-800/50 ${item.readAt ? 'opacity-65' : ''}`}>
                            <div className="flex gap-3"><Bell className={`mt-0.5 h-4 w-4 ${item.priority === 'urgent' || item.priority === 'high' ? 'text-amber-400' : 'text-teal-400'}`} /><div className="min-w-0"><div className="text-sm font-medium text-zinc-100">{item.title}</div><p className="mt-1 text-sm leading-6 text-zinc-400">{item.message}</p><div className="mt-2 text-xs text-zinc-600">{new Date(item.createdAt).toLocaleString()}</div></div></div>
                        </Link>
                    ))}
                </section>
                <aside className="h-fit space-y-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                    <div><h2 className="text-sm font-semibold text-white">Delivery preferences</h2><p className="mt-1 text-xs leading-5 text-zinc-500">Quiet hours use your selected timezone. Urgent alerts can bypass them.</p></div>
                    <label className="block text-xs text-zinc-400">Timezone<input value={preferences.timezone || 'UTC'} onChange={e => setPreferences({ ...preferences, timezone: e.target.value })} className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" /></label>
                    <div className="space-y-3">
                        {[['inApp', 'In-app', Bell], ['email', 'Email', Mail]].map(([key, label, Icon]: any) => <label key={key} className="flex items-center justify-between text-sm text-zinc-300"><span className="flex items-center gap-2"><Icon className="h-4 w-4 text-zinc-500" />{label}</span><input type="checkbox" checked={preferences.channels?.[key] !== false} onChange={e => setPreferences({ ...preferences, channels: { ...preferences.channels, [key]: e.target.checked } })} /></label>)}
                        <button onClick={enablePush} className="flex w-full items-center justify-between text-sm text-zinc-300"><span className="flex items-center gap-2"><MonitorUp className="h-4 w-4 text-zinc-500" />Browser push</span><span className="text-xs text-teal-400">{preferences.channels?.browserPush ? 'Enabled' : 'Enable'}</span></button>
                    </div>
                    <div className="border-t border-zinc-800 pt-4"><label className="flex items-center justify-between text-sm text-zinc-300"><span className="flex items-center gap-2"><Moon className="h-4 w-4 text-zinc-500" />Quiet hours</span><input type="checkbox" checked={preferences.quietHours?.enabled || false} onChange={e => setPreferences({ ...preferences, quietHours: { ...preferences.quietHours, enabled: e.target.checked } })} /></label><div className="mt-3 grid grid-cols-2 gap-2"><input type="time" value={preferences.quietHours?.start || '22:00'} onChange={e => setPreferences({ ...preferences, quietHours: { ...preferences.quietHours, start: e.target.value } })} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm" /><input type="time" value={preferences.quietHours?.end || '07:00'} onChange={e => setPreferences({ ...preferences, quietHours: { ...preferences.quietHours, end: e.target.value } })} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm" /></div></div>
                    <button onClick={save} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-500"><Save className="h-4 w-4" />Save preferences</button>
                </aside>
            </div>
        </div>
    );
}
