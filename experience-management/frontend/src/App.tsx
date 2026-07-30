import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Switch } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { PlatformAdminShell } from '@/components/platform-admin/PlatformAdminShell';
import { Navigate, PageLoader } from '@/lib/router';

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const SurveysPage = lazy(() => import('@/pages/SurveysPage').then((module) => ({ default: module.SurveysPage })));
const CreateSurveyPage = lazy(() => import('@/pages/CreateSurveyPage').then((module) => ({ default: module.CreateSurveyPage })));
const SurveyStudioPage = lazy(() => import('@/pages/SurveyStudioPage').then((module) => ({ default: module.SurveyStudioPage })));
const PublicSurveyPage = lazy(() => import('@/pages/PublicSurveyPage').then((module) => ({ default: module.PublicSurveyPage })));
const AiQueuePage = lazy(() => import('@/pages/AiQueuePage').then((module) => ({ default: module.AiQueuePage })));
const TicketsPage = lazy(() => import('@/pages/TicketsPage').then((module) => ({ default: module.TicketsPage })));
const SocialListeningPage = lazy(() => import('@/pages/SocialListeningPage').then((module) => ({ default: module.SocialListeningPage })));
const IntelligencePage = lazy(() => import('@/pages/IntelligencePage').then((module) => ({ default: module.IntelligencePage })));
const KnowledgeBasesPage = lazy(() => import('@/pages/KnowledgeBasesPage').then((module) => ({ default: module.KnowledgeBasesPage })));
const KnowledgeBaseWorkspacePage = lazy(() => import('@/pages/KnowledgeBaseWorkspacePage').then((module) => ({ default: module.KnowledgeBaseWorkspacePage })));
const JourneysPage = lazy(() => import('@/pages/JourneysPage').then((module) => ({ default: module.JourneysPage })));
const CampaignsPage = lazy(() => import('@/pages/CampaignsPage').then((module) => ({ default: module.CampaignsPage })));
const CampaignWorkspacePage = lazy(() => import('@/pages/CampaignWorkspacePage').then((module) => ({ default: module.CampaignWorkspacePage })));
const AgreementsPage = lazy(() => import('@/pages/AgreementsPage').then((module) => ({ default: module.AgreementsPage })));
const NewAgreementPage = lazy(() => import('@/pages/NewAgreementPage').then((module) => ({ default: module.NewAgreementPage })));
const AgreementWorkspacePage = lazy(() => import('@/pages/AgreementWorkspacePage').then((module) => ({ default: module.AgreementWorkspacePage })));
const AgreementPreparePage = lazy(() => import('@/pages/AgreementPreparePage').then((module) => ({ default: module.AgreementPreparePage })));
const PublicSigningPage = lazy(() => import('@/pages/PublicSigningPage').then((module) => ({ default: module.PublicSigningPage })));
const MyDocumentsPage = lazy(() => import('@/pages/MyDocumentsPage').then((module) => ({ default: module.MyDocumentsPage })));
const CertificateVerificationPage = lazy(() => import('@/pages/CertificateVerificationPage').then((module) => ({ default: module.CertificateVerificationPage })));
const LoginPage = lazy(() => import('@/pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const SignupPage = lazy(() => import('@/pages/SignupPage').then((module) => ({ default: module.SignupPage })));
const EmailVerificationPage = lazy(() => import('@/pages/EmailVerificationPage').then((module) => ({ default: module.EmailVerificationPage })));
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage').then((module) => ({ default: module.OnboardingPage })));
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })));
const LegalPage = lazy(() => import('@/pages/LegalPage').then((module) => ({ default: module.LegalPage })));
const JoinSpacePage = lazy(() => import('@/pages/JoinSpacePage').then((module) => ({ default: module.JoinSpacePage })));
const SpaceSettingsPage = lazy(() => import('@/pages/SpaceSettingsPage').then((module) => ({ default: module.SpaceSettingsPage })));
const PlatformAdminOverviewPage = lazy(() => import('@/pages/platform-admin/OverviewPage').then((module) => ({ default: module.PlatformAdminOverviewPage })));
const PlatformAdminUsersPage = lazy(() => import('@/pages/platform-admin/UsersPage').then((module) => ({ default: module.PlatformAdminUsersPage })));
const PlatformAdminUserDetailPage = lazy(() => import('@/pages/platform-admin/UserDetailPage').then((module) => ({ default: module.PlatformAdminUserDetailPage })));
const PlatformAdminSpacesPage = lazy(() => import('@/pages/platform-admin/SpacesPage').then((module) => ({ default: module.PlatformAdminSpacesPage })));
const PlatformAdminSpaceDetailPage = lazy(() => import('@/pages/platform-admin/SpaceDetailPage').then((module) => ({ default: module.PlatformAdminSpaceDetailPage })));
const PlatformAdminSubscriptionsPage = lazy(() => import('@/pages/platform-admin/SubscriptionsPage').then((module) => ({ default: module.PlatformAdminSubscriptionsPage })));
const PlatformAdminSubscriptionRequestsPage = lazy(() => import('@/pages/platform-admin/SubscriptionRequestsPage').then((module) => ({ default: module.PlatformAdminSubscriptionRequestsPage })));
const PlatformAdminSubscriptionRequestDetailPage = lazy(() => import('@/pages/platform-admin/SubscriptionRequestDetailPage').then((module) => ({ default: module.PlatformAdminSubscriptionRequestDetailPage })));
const PlatformAdminAnalyticsPage = lazy(() => import('@/pages/platform-admin/AnalyticsPage').then((module) => ({ default: module.PlatformAdminAnalyticsPage })));
const PlatformAdminAuditPage = lazy(() => import('@/pages/platform-admin/AuditPage').then((module) => ({ default: module.PlatformAdminAuditPage })));
const PlatformAdminAuditDetailPage = lazy(() => import('@/pages/platform-admin/AuditDetailPage').then((module) => ({ default: module.PlatformAdminAuditDetailPage })));
function Admin({ children }: { children: ReactNode }) { return <AppShell>{children}</AppShell>; }
function PlatformAdmin({ children }: { children: ReactNode }) { return <PlatformAdminShell>{children}</PlatformAdminShell>; }

export function App() {
  return <Suspense fallback={<PageLoader />}><Switch>
    <Route path="/s/:slug"><PublicSurveyPage /></Route>
    <Route path="/sign/:token"><PublicSigningPage /></Route>
    <Route path="/sign"><PublicSigningPage /></Route>
    <Route path="/my-documents"><MyDocumentsPage /></Route>
    <Route path="/verify/:certificateId"><CertificateVerificationPage /></Route>
    <Route path="/join/:token"><JoinSpacePage /></Route>
    <Route path="/login"><LoginPage /></Route>
    <Route path="/signup"><SignupPage /></Route>
    <Route path="/verify-email"><EmailVerificationPage /></Route>
    <Route path="/onboarding"><OnboardingPage /></Route>
    <Route path="/forgot-password"><ForgotPasswordPage /></Route>
    <Route path="/reset-password"><ResetPasswordPage /></Route>
    <Route path="/legal/terms"><LegalPage kind="terms" /></Route>
    <Route path="/legal/privacy"><LegalPage kind="privacy" /></Route>
    <Route path="/admin/users/:id"><PlatformAdmin><PlatformAdminUserDetailPage /></PlatformAdmin></Route>
    <Route path="/admin/users"><PlatformAdmin><PlatformAdminUsersPage /></PlatformAdmin></Route>
    <Route path="/admin/spaces/:id"><PlatformAdmin><PlatformAdminSpaceDetailPage /></PlatformAdmin></Route>
    <Route path="/admin/spaces"><PlatformAdmin><PlatformAdminSpacesPage /></PlatformAdmin></Route>
    <Route path="/admin/subscriptions"><PlatformAdmin><PlatformAdminSubscriptionsPage /></PlatformAdmin></Route>
    <Route path="/admin/subscription-requests/:id"><PlatformAdmin><PlatformAdminSubscriptionRequestDetailPage /></PlatformAdmin></Route>
    <Route path="/admin/subscription-requests"><PlatformAdmin><PlatformAdminSubscriptionRequestsPage /></PlatformAdmin></Route>
    <Route path="/admin/analytics"><PlatformAdmin><PlatformAdminAnalyticsPage /></PlatformAdmin></Route>
    <Route path="/admin/audit/:id"><PlatformAdmin><PlatformAdminAuditDetailPage /></PlatformAdmin></Route>
    <Route path="/admin/audit"><PlatformAdmin><PlatformAdminAuditPage /></PlatformAdmin></Route>
    <Route path="/admin"><PlatformAdmin><PlatformAdminOverviewPage /></PlatformAdmin></Route>
    <Route path="/surveys/new"><Admin><CreateSurveyPage /></Admin></Route>
    <Route path="/surveys/:id"><Admin><SurveyStudioPage /></Admin></Route>
    <Route path="/surveys"><Admin><SurveysPage /></Admin></Route>
    <Route path="/campaigns/:id"><Admin><CampaignWorkspacePage /></Admin></Route>
    <Route path="/campaigns"><Admin><CampaignsPage /></Admin></Route>
    <Route path="/agreements/new"><Admin><NewAgreementPage /></Admin></Route>
    <Route path="/agreements/:id/prepare"><Admin><AgreementPreparePage /></Admin></Route>
    <Route path="/agreements/:id"><Admin><AgreementWorkspacePage /></Admin></Route>
    <Route path="/agreements"><Admin><AgreementsPage /></Admin></Route>
    <Route path="/social-listening"><Admin><SocialListeningPage /></Admin></Route>
    <Route path="/intelligence"><Admin><IntelligencePage /></Admin></Route>
    <Route path="/knowledge-bases/:id"><Admin><KnowledgeBaseWorkspacePage /></Admin></Route>
    <Route path="/knowledge-bases"><Admin><KnowledgeBasesPage /></Admin></Route>
    <Route path="/journeys"><Admin><JourneysPage /></Admin></Route>
    <Route path="/ai-queue"><Admin><AiQueuePage /></Admin></Route>
    <Route path="/tickets"><Admin><TicketsPage /></Admin></Route>
    <Route path="/settings/space"><Admin><SpaceSettingsPage /></Admin></Route>
    <Route path="/settings/profile"><Admin><ProfilePage /></Admin></Route>
    <Route path="/"><Admin><DashboardPage /></Admin></Route>
    <Route><Navigate to="/" /></Route>
  </Switch></Suspense>;
}
