import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Switch } from 'wouter';
import { AppShell } from '@/components/AppShell';
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
const JourneysPage = lazy(() => import('@/pages/JourneysPage').then((module) => ({ default: module.JourneysPage })));
const CampaignsPage = lazy(() => import('@/pages/CampaignsPage').then((module) => ({ default: module.CampaignsPage })));
const CampaignWorkspacePage = lazy(() => import('@/pages/CampaignWorkspacePage').then((module) => ({ default: module.CampaignWorkspacePage })));
const AgreementsPage = lazy(() => import('@/pages/AgreementsPage').then((module) => ({ default: module.AgreementsPage })));
const NewAgreementPage = lazy(() => import('@/pages/NewAgreementPage').then((module) => ({ default: module.NewAgreementPage })));
const AgreementWorkspacePage = lazy(() => import('@/pages/AgreementWorkspacePage').then((module) => ({ default: module.AgreementWorkspacePage })));
const AgreementPreparePage = lazy(() => import('@/pages/AgreementPreparePage').then((module) => ({ default: module.AgreementPreparePage })));
const PublicSigningPage = lazy(() => import('@/pages/PublicSigningPage').then((module) => ({ default: module.PublicSigningPage })));
const CertificateVerificationPage = lazy(() => import('@/pages/CertificateVerificationPage').then((module) => ({ default: module.CertificateVerificationPage })));
const LoginPage = lazy(() => import('@/pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const SignupPage = lazy(() => import('@/pages/SignupPage').then((module) => ({ default: module.SignupPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })));
const LegalPage = lazy(() => import('@/pages/LegalPage').then((module) => ({ default: module.LegalPage })));
const JoinSpacePage = lazy(() => import('@/pages/JoinSpacePage').then((module) => ({ default: module.JoinSpacePage })));
const SpaceSettingsPage = lazy(() => import('@/pages/SpaceSettingsPage').then((module) => ({ default: module.SpaceSettingsPage })));
function Admin({ children }: { children: ReactNode }) { return <AppShell>{children}</AppShell>; }

export function App() {
  return <Suspense fallback={<PageLoader />}><Switch>
    <Route path="/s/:slug"><PublicSurveyPage /></Route>
    <Route path="/sign/:token"><PublicSigningPage /></Route>
    <Route path="/sign"><PublicSigningPage /></Route>
    <Route path="/verify/:certificateId"><CertificateVerificationPage /></Route>
    <Route path="/join/:token"><JoinSpacePage /></Route>
    <Route path="/login"><LoginPage /></Route>
    <Route path="/signup"><SignupPage /></Route>
    <Route path="/forgot-password"><ForgotPasswordPage /></Route>
    <Route path="/reset-password"><ResetPasswordPage /></Route>
    <Route path="/legal/terms"><LegalPage kind="terms" /></Route>
    <Route path="/legal/privacy"><LegalPage kind="privacy" /></Route>
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
    <Route path="/journeys"><Admin><JourneysPage /></Admin></Route>
    <Route path="/ai-queue"><Admin><AiQueuePage /></Admin></Route>
    <Route path="/tickets"><Admin><TicketsPage /></Admin></Route>
    <Route path="/settings/space"><Admin><SpaceSettingsPage /></Admin></Route>
    <Route path="/"><Admin><DashboardPage /></Admin></Route>
    <Route><Navigate to="/" /></Route>
  </Switch></Suspense>;
}
