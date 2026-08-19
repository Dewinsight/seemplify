import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import AppShell from '@/components/AppShell';
import ApiErrorNotice from '@/components/ApiErrorNotice';
import { themeInitScript } from '@/lib/theme-sync';

export const metadata = {
    title: 'Time & Attendance - Seemplify',
    description: 'Track work hours, manage timesheets, and handle approvals',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
            <body className="bg-background text-foreground font-sans antialiased">
                <AuthProvider>
                    <AppShell>{children}</AppShell>
                    <ApiErrorNotice />
                </AuthProvider>
            </body>
        </html>
    );
}
