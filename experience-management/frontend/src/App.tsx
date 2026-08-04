import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Switch } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { PlatformAdminShell } from '@/components/platform-admin/PlatformAdminShell';
import { Navigate, PageContentLoader, PageLoader } from '@/lib/router';

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const SurveysPage = lazy(() => import('@/pages/SurveysPage').then((module) => ({ default: module.SurveysPage })));
const CreateSurveyPage = lazy(() => import('@/pages/CreateSurveyPage').then((module) => ({ default: module.CreateSurveyPage })));
const SurveyStudioPage = lazy(() => import('@/pages/SurveyStudioPage').then((module) => ({ default: module.SurveyStudioPage })));
const PublicSurveyPage = lazy(() => import('@/pages/PublicSurveyPage').then((module) => ({ default: module.PublicSurveyPage })));
const AiQueuePage = lazy(() => import('@/pages/AiQueuePage').then((module) => ({ default: module.AiQueuePage })));
const TicketsPage = lazy(() => import('@/pages/TicketsPage').then((module) => ({ default: module.TicketsPage })));
const SocialListeningPage = lazy(() => import('@/pages/SocialListeningPage').then((module) => ({ default: module.SocialListeningPage })));
const IntelligencePage = lazy(() => import('@/pages/IntelligencePage').then((module) => ({ default: module.IntelligencePage })));
const PersonalAssistantPage = lazy(() => import('@/pages/PersonalAssistantPage').then((module) => ({ default: module.PersonalAssistantPage })));
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
const PlatformAdminJobsPage = lazy(() => import('@/pages/platform-admin/JobsPage').then((module) => ({ default: module.PlatformAdminJobsPage })));
const PlatformAdminJobDetailPage = lazy(() => import('@/pages/platform-admin/JobDetailPage').then((module) => ({ default: module.PlatformAdminJobDetailPage })));
const PlatformAdminActivityPage = lazy(() => import('@/pages/platform-admin/ActivityPage').then((module) => ({ default: module.PlatformAdminActivityPage })));
const PlatformAdminRolesPage = lazy(() => import('@/pages/platform-admin/RolesPage').then((module) => ({ default: module.PlatformAdminRolesPage })));
const PlatformAdminAiDefaultsPage = lazy(() => import('@/pages/platform-admin/AiDefaultsPage').then((module) => ({ default: module.PlatformAdminAiDefaultsPage })));
const PlatformAdminAuditPage = lazy(() => import('@/pages/platform-admin/AuditPage').then((module) => ({ default: module.PlatformAdminAuditPage })));
const PlatformAdminAuditDetailPage = lazy(() => import('@/pages/platform-admin/AuditDetailPage').then((module) => ({ default: module.PlatformAdminAuditDetailPage })));

function StandalonePage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

function PlatformAdminRoutes() {
  return <Switch>
    <Route path="/admin/users/:id"><PlatformAdminUserDetailPage /></Route>
    <Route path="/admin/users"><PlatformAdminUsersPage /></Route>
    <Route path="/admin/spaces/:id"><PlatformAdminSpaceDetailPage /></Route>
    <Route path="/admin/spaces"><PlatformAdminSpacesPage /></Route>
    <Route path="/admin/subscriptions"><PlatformAdminSubscriptionsPage /></Route>
    <Route path="/admin/subscription-requests/:id"><PlatformAdminSubscriptionRequestDetailPage /></Route>
    <Route path="/admin/subscription-requests"><PlatformAdminSubscriptionRequestsPage /></Route>
    <Route path="/admin/analytics"><PlatformAdminAnalyticsPage /></Route>
    <Route path="/admin/jobs/:id"><PlatformAdminJobDetailPage /></Route>
    <Route path="/admin/jobs"><PlatformAdminJobsPage /></Route>
    <Route path="/admin/activity"><PlatformAdminActivityPage /></Route>
    <Route path="/admin/roles"><PlatformAdminRolesPage /></Route>
    <Route path="/admin/ai-defaults"><PlatformAdminAiDefaultsPage /></Route>
    <Route path="/admin/audit/:id"><PlatformAdminAuditDetailPage /></Route>
    <Route path="/admin/audit"><PlatformAdminAuditPage /></Route>
    <Route path="/admin"><PlatformAdminOverviewPage /></Route>
    <Route><Navigate to="/admin" /></Route>
  </Switch>;
}

function PlatformAdministration() {
  return <PlatformAdminShell>
    <Suspense fallback={<PageContentLoader />}><PlatformAdminRoutes /></Suspense>
  </PlatformAdminShell>;
}

function ExperienceRoutes() {
  return <Switch>
    <Route path="/surveys/new"><CreateSurveyPage /></Route>
    <Route path="/surveys/:id"><SurveyStudioPage /></Route>
    <Route path="/surveys"><SurveysPage /></Route>
    <Route path="/campaigns/:id"><CampaignWorkspacePage /></Route>
    <Route path="/campaigns"><CampaignsPage /></Route>
    <Route path="/agreements/new"><NewAgreementPage /></Route>
    <Route path="/agreements/:id/prepare"><AgreementPreparePage /></Route>
    <Route path="/agreements/:id"><AgreementWorkspacePage /></Route>
    <Route path="/agreements"><AgreementsPage /></Route>
    <Route path="/social-listening"><SocialListeningPage /></Route>
    <Route path="/intelligence"><IntelligencePage /></Route>
    <Route path="/assistant"><PersonalAssistantPage /></Route>
    <Route path="/knowledge-bases/:id"><KnowledgeBaseWorkspacePage /></Route>
    <Route path="/knowledge-bases"><KnowledgeBasesPage /></Route>
    <Route path="/journeys"><JourneysPage /></Route>
    <Route path="/ai-queue"><AiQueuePage /></Route>
    <Route path="/tickets"><TicketsPage /></Route>
    <Route path="/settings/space"><SpaceSettingsPage /></Route>
    <Route path="/settings/profile"><ProfilePage /></Route>
    <Route path="/"><DashboardPage /></Route>
    <Route><Navigate to="/" /></Route>
  </Switch>;
}

function ExperienceApplication() {
  return <AppShell>
    <Suspense fallback={<PageContentLoader />}><ExperienceRoutes /></Suspense>
  </AppShell>;
}

export function App() {
  return <Switch>
    <Route path="/s/:slug"><StandalonePage><PublicSurveyPage /></StandalonePage></Route>
    <Route path="/sign/:token"><StandalonePage><PublicSigningPage /></StandalonePage></Route>
    <Route path="/sign"><StandalonePage><PublicSigningPage /></StandalonePage></Route>
    <Route path="/my-documents"><StandalonePage><MyDocumentsPage /></StandalonePage></Route>
    <Route path="/verify/:certificateId"><StandalonePage><CertificateVerificationPage /></StandalonePage></Route>
    <Route path="/join/:token"><StandalonePage><JoinSpacePage /></StandalonePage></Route>
    <Route path="/login"><StandalonePage><LoginPage /></StandalonePage></Route>
    <Route path="/signup"><StandalonePage><SignupPage /></StandalonePage></Route>
    <Route path="/verify-email"><StandalonePage><EmailVerificationPage /></StandalonePage></Route>
    <Route path="/onboarding"><StandalonePage><OnboardingPage /></StandalonePage></Route>
    <Route path="/forgot-password"><StandalonePage><ForgotPasswordPage /></StandalonePage></Route>
    <Route path="/reset-password"><StandalonePage><ResetPasswordPage /></StandalonePage></Route>
    <Route path="/legal/terms"><StandalonePage><LegalPage kind="terms" /></StandalonePage></Route>
    <Route path="/legal/privacy"><StandalonePage><LegalPage kind="privacy" /></StandalonePage></Route>
    <Route path="/admin/*?"><PlatformAdministration /></Route>
    <Route><ExperienceApplication /></Route>
  </Switch>;
}
