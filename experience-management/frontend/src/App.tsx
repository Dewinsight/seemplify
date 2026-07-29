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
const LoginPage = lazy(() => import('@/pages/LoginPage').then((module) => ({ default: module.LoginPage })));
function Admin({ children }: { children: ReactNode }) { return <AppShell>{children}</AppShell>; }

export function App() {
  return <Suspense fallback={<PageLoader />}><Switch>
    <Route path="/s/:slug"><PublicSurveyPage /></Route>
    <Route path="/login"><LoginPage /></Route>
    <Route path="/surveys/new"><Admin><CreateSurveyPage /></Admin></Route>
    <Route path="/surveys/:id"><Admin><SurveyStudioPage /></Admin></Route>
    <Route path="/surveys"><Admin><SurveysPage /></Admin></Route>
    <Route path="/ai-queue"><Admin><AiQueuePage /></Admin></Route>
    <Route path="/tickets"><Admin><TicketsPage /></Admin></Route>
    <Route path="/"><Admin><DashboardPage /></Admin></Route>
    <Route><Navigate to="/" /></Route>
  </Switch></Suspense>;
}
