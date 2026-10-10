import { lazy, Suspense } from 'react';
import { createBrowserRouter, Link } from 'react-router';
import { AppShell } from './layouts/AppShell.jsx';
import { GuestOnly, OnboardingGate, RequireAuth, RequirePermission, RequireWorkspace } from './guards.jsx';
import { RequirePlatformSession } from '../features/platform/PlatformAuth.jsx';
import { SplashScreen } from '../components/feedback/PageLoader.jsx';
import { LogoMark } from '../components/brand/Logo.jsx';

// Route-level code splitting: each area loads on first visit.
const page = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));

const LoginPage = page(() => import('../features/auth/LoginPage.jsx'), 'LoginPage');
const RegisterPage = page(() => import('../features/auth/RegisterPage.jsx'), 'RegisterPage');
const VerifyEmailPage = page(() => import('../features/auth/VerifyEmailPage.jsx'), 'VerifyEmailPage');
const ForgotPasswordPage = page(() => import('../features/auth/PasswordPages.jsx'), 'ForgotPasswordPage');
const ResetPasswordPage = page(() => import('../features/auth/PasswordPages.jsx'), 'ResetPasswordPage');
const AcceptInvitePage = page(() => import('../features/auth/AcceptInvitePage.jsx'), 'AcceptInvitePage');
const OnboardingPage = page(() => import('../features/auth/OnboardingPage.jsx'), 'OnboardingPage');
const DashboardPage = page(() => import('../features/dashboard/DashboardPage.jsx'), 'DashboardPage');
const MyWorkPage = page(() => import('../features/tasks/MyWorkPage.jsx'), 'MyWorkPage');
const TasksPage = page(() => import('../features/tasks/TasksPage.jsx'), 'TasksPage');
const ProjectsPage = page(() => import('../features/projects/ProjectsPage.jsx'), 'ProjectsPage');
const ProjectDetailPage = page(() => import('../features/projects/ProjectDetailPage.jsx'), 'ProjectDetailPage');
const TeamPage = page(() => import('../features/team/TeamPage.jsx'), 'TeamPage');
const RolesPage = page(() => import('../features/roles/RolesPage.jsx'), 'RolesPage');
const ActivityPage = page(() => import('../features/activity/ActivityPage.jsx'), 'ActivityPage');
const BillingPage = page(() => import('../features/billing/BillingPage.jsx'), 'BillingPage');
const PaymentReturnPage = page(() => import('../features/billing/PaymentReturnPage.jsx'), 'PaymentReturnPage');
const SettingsPage = page(() => import('../features/settings/SettingsPage.jsx'), 'SettingsPage');
const PlatformOverviewPage = page(() => import('../features/platform/PlatformPages.jsx'), 'PlatformOverviewPage');
const PlatformOrganizationsPage = page(() => import('../features/platform/PlatformPages.jsx'), 'PlatformOrganizationsPage');
const PlatformPlansPage = page(() => import('../features/platform/PlatformPages.jsx'), 'PlatformPlansPage');
const PlatformPaymentsPage = page(() => import('../features/platform/PlatformPages.jsx'), 'PlatformPaymentsPage');
const PlatformLoginPage = page(() => import('../features/platform/PlatformAuth.jsx'), 'PlatformLoginPage');

const standalone = (el) => <Suspense fallback={<SplashScreen />}>{el}</Suspense>;
const guard = (any, el) => <RequirePermission any={any}>{el}</RequirePermission>;

function NotFoundPage() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 text-center">
      <LogoMark size={36} />
      <h1 className="mt-4 text-lg font-semibold">Page not found</h1>
      <p className="mt-1 text-[13px] text-ink-muted">The link may be broken, or the page may have moved.</p>
      <Link to="/" className="mt-4 text-[13px] font-medium text-brand-700 hover:underline">
        Go to dashboard
      </Link>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: standalone(<LoginPage />) },
      { path: '/register', element: standalone(<RegisterPage />) },
      { path: '/forgot-password', element: standalone(<ForgotPasswordPage />) },
    ],
  },
  // Links from emails work whether or not someone is signed in.
  { path: '/verify-email', element: standalone(<VerifyEmailPage />) },
  { path: '/reset-password', element: standalone(<ResetPasswordPage />) },
  { path: '/accept-invite', element: standalone(<AcceptInvitePage />) },
  // Platform console: its own sign-in and session, independent of the tenant app's.
  { path: '/platform/login', element: standalone(<PlatformLoginPage />) },
  {
    path: '/platform',
    element: <RequirePlatformSession />,
    children: [
      {
        element: <AppShell platform />,
        children: [
          { index: true, element: <PlatformOverviewPage /> },
          { path: 'organizations', element: <PlatformOrganizationsPage /> },
          { path: 'plans', element: <PlatformPlansPage /> },
          { path: 'payments', element: <PlatformPaymentsPage /> },
        ],
      },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', element: <OnboardingGate>{standalone(<OnboardingPage />)}</OnboardingGate> },
      {
        element: <RequireWorkspace />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/', element: <DashboardPage /> },
              { path: '/my-work', element: guard(['TASK_VIEW'], <MyWorkPage />) },
              { path: '/tasks', element: guard(['TASK_VIEW'], <TasksPage />) },
              { path: '/projects', element: guard(['PROJECT_VIEW', 'PROJECT_VIEW_ALL'], <ProjectsPage />) },
              { path: '/projects/:id', element: guard(['PROJECT_VIEW', 'PROJECT_VIEW_ALL'], <ProjectDetailPage />) },
              { path: '/team', element: guard(['USER_VIEW'], <TeamPage />) },
              { path: '/roles', element: guard(['ROLE_VIEW'], <RolesPage />) },
              { path: '/activity', element: guard(['ACTIVITY_VIEW'], <ActivityPage />) },
              { path: '/billing', element: guard(['SUBSCRIPTION_VIEW', 'BILLING_VIEW'], <BillingPage />) },
              { path: '/billing/return', element: guard(['BILLING_VIEW'], <PaymentReturnPage />) },
              { path: '/settings', element: <SettingsPage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);

