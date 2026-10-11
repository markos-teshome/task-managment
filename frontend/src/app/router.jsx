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
const BranchesPage = page(() => import('../features/branches/BranchesPage.jsx'), 'BranchesPage');
const BranchDetailPage = page(() => import('../features/branches/BranchDetailPage.jsx'), 'BranchDetailPage');
const RolesPage = page(() => import('../features/roles/RolesPage.jsx'), 'RolesPage');
const ActivityPage = page(() => import('../features/activity/ActivityPage.jsx'), 'ActivityPage');
const BillingPage = page(() => import('../features/billing/BillingPage.jsx'), 'BillingPage');
const PaymentReturnPage = page(() => import('../features/billing/PaymentReturnPage.jsx'), 'PaymentReturnPage');
const ResolveBillingPage = page(() => import('../features/billing/ResolveBillingPage.jsx'), 'ResolveBillingPage');
const ResolveBillingReturnPage = page(() => import('../features/billing/ResolveBillingPage.jsx'), 'ResolveBillingReturnPage');
const NotificationsPage = page(() => import('../features/notifications/NotificationsPage.jsx'), 'NotificationsPage');
const SettingsPage = page(() => import('../features/settings/SettingsPage.jsx'), 'SettingsPage');
const PlatformForgotPasswordPage = page(() => import('../features/auth/PasswordPages.jsx'), 'PlatformForgotPasswordPage');
const PlatformResetPasswordPage = page(() => import('../features/auth/PasswordPages.jsx'), 'PlatformResetPasswordPage');
const PlatformLoginPage = page(() => import('../features/platform/PlatformAuth.jsx'), 'PlatformLoginPage');
const PlatformOverviewPage = page(() => import('../features/platform/PlatformOverviewPage.jsx'), 'PlatformOverviewPage');
const PlatformOrganizationsPage = page(() => import('../features/platform/PlatformOrganizationsPage.jsx'), 'PlatformOrganizationsPage');
const PlatformOrganizationDetailPage = page(() => import('../features/platform/PlatformOrganizationDetailPage.jsx'), 'PlatformOrganizationDetailPage');
const PlatformSubscriptionsPage = page(() => import('../features/platform/PlatformBillingPages.jsx'), 'PlatformSubscriptionsPage');
const PlatformPaymentsPage = page(() => import('../features/platform/PlatformBillingPages.jsx'), 'PlatformPaymentsPage');
const PlatformPlansPage = page(() => import('../features/platform/PlatformBillingPages.jsx'), 'PlatformPlansPage');
const PlatformActivityPage = page(() => import('../features/platform/PlatformOpsPages.jsx'), 'PlatformActivityPage');
const PlatformHealthPage = page(() => import('../features/platform/PlatformOpsPages.jsx'), 'PlatformHealthPage');

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
  { path: '/platform/forgot-password', element: standalone(<PlatformForgotPasswordPage />) },
  { path: '/platform/reset-password', element: standalone(<PlatformResetPasswordPage />) },
  {
    path: '/platform',
    element: <RequirePlatformSession />,
    children: [
      {
        element: <AppShell platform />,
        children: [
          { index: true, element: <PlatformOverviewPage /> },
          { path: 'organizations', element: <PlatformOrganizationsPage /> },
          { path: 'organizations/:id', element: <PlatformOrganizationDetailPage /> },
          { path: 'subscriptions', element: <PlatformSubscriptionsPage /> },
          { path: 'payments', element: <PlatformPaymentsPage /> },
          { path: 'plans', element: <PlatformPlansPage /> },
          { path: 'activity', element: <PlatformActivityPage /> },
          { path: 'health', element: <PlatformHealthPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', element: <OnboardingGate>{standalone(<OnboardingPage />)}</OnboardingGate> },
      // D-13: a suspended organization's billing holder can pay from outside the workspace.
      { path: '/resolve-billing', element: <OnboardingGate>{standalone(<ResolveBillingPage />)}</OnboardingGate> },
      { path: '/resolve-billing/return', element: <OnboardingGate>{standalone(<ResolveBillingReturnPage />)}</OnboardingGate> },
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
              // No page gate: the API returns only the branches the person may see.
              { path: '/branches', element: <BranchesPage /> },
              { path: '/branches/:id', element: <BranchDetailPage /> },
              { path: '/roles', element: guard(['ROLE_VIEW'], <RolesPage />) },
              { path: '/activity', element: guard(['ACTIVITY_VIEW'], <ActivityPage />) },
              { path: '/billing', element: guard(['SUBSCRIPTION_VIEW', 'BILLING_VIEW'], <BillingPage />) },
              { path: '/billing/return', element: guard(['BILLING_VIEW'], <PaymentReturnPage />) },
              { path: '/notifications', element: <NotificationsPage /> },
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

