import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FolderKanban, Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { api } from '../../lib/api.js';
import { WorkRow } from '../tasks/MyWorkPage.jsx';
import { DueLabel } from '../tasks/components.jsx';
import { ActivityItem } from '../activity/ActivityItem.jsx';
import { ProjectFormModal } from '../projects/ProjectFormModal.jsx';
import { Button, ButtonLink } from '../../components/ui/Button.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Progress, UsageMeter } from '../../components/ui/Progress.jsx';
import { Skeleton } from '../../components/ui/Misc.jsx';
import { Section } from '../../components/layout/PageHeader.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { PROJECT_STATUS } from '../../lib/status.js';
import { formatDate, greeting } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

/** One compact figure in the metrics strip. */
function Metric({ label, value, sub, tone, to }) {
  const body = (
    <>
      <span className="block text-[11.5px] font-medium uppercase tracking-wide text-ink-subtle">{label}</span>
      <span className={cn('mt-0.5 block text-2xl font-semibold tabular-nums leading-tight', tone === 'danger' && value > 0 ? 'text-danger-600' : 'text-ink')}>{value}</span>
      {sub && <span className="block text-xs text-ink-muted">{sub}</span>}
    </>
  );
  return to ? (
    <Link to={to} className="block min-w-[140px] flex-1 bg-surface px-4 py-3 transition-colors hover:bg-canvas">
      {body}
    </Link>
  ) : (
    <div className="min-w-[140px] flex-1 bg-surface px-4 py-3">{body}</div>
  );
}

function MetricsStrip({ stats, canProjects }) {
  const items = [
    canProjects && stats.activeProjects !== null && { label: 'Active projects', value: stats.activeProjects, sub: `of ${stats.totalProjects} total`, to: '/projects?status=ACTIVE' },
    stats.openTasks !== null && { label: 'Open tasks', value: stats.openTasks, sub: 'Across your projects', to: '/tasks' },
    stats.dueSoon !== null && { label: 'Due this week', value: stats.dueSoon, sub: 'Next 7 days', to: '/tasks?due=week' },
    stats.overdue !== null && { label: 'Overdue', value: stats.overdue, sub: stats.overdue ? 'Needs attention' : 'Nothing late', tone: 'danger', to: '/tasks?due=overdue' },
    stats.completionRate !== null && { label: 'Completion', value: `${stats.completionRate}%`, sub: 'Of all tasks done' },
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="mb-6 flex flex-wrap gap-px overflow-hidden rounded-lg border border-line bg-line">
      {items.map((m) => (
        <Metric key={m.label} {...m} />
      ))}
    </div>
  );
}

function MyWorkBlock({ work }) {
  const rows = [...work.overdue, ...work.today, ...work.upcoming].slice(0, 7);
  return (
    <Section
      title="My work"
      id="dash-mywork"
      action={
        <Link to="/my-work" className="text-xs font-medium text-brand-700 hover:underline">
          Open My Work
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] text-ink-muted">
          <CheckCircle2 size={16} className="shrink-0 text-success-600" aria-hidden="true" />
          <span><span className="font-medium text-ink">You're all caught up.</span> No open tasks are assigned to you.</span>
        </p>
      ) : (
        <>
          <p className="mb-1.5 text-xs text-ink-muted">
            {work.counts.overdue > 0 && <span className="font-medium text-danger-600">{work.counts.overdue} overdue · </span>}
            {work.counts.today} due today · {work.counts.upcoming} upcoming
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {rows.map((t) => (
              <WorkRow key={t.id} task={t} />
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function ProjectsBlock({ projects, canCreate, onCreate }) {
  return (
    <Section
      title="Project progress"
      id="dash-projects"
      action={
        <Link to="/projects" className="text-xs font-medium text-brand-700 hover:underline">
          All projects
        </Link>
      }
    >
      {projects.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState
            compact
            icon={FolderKanban}
            title="No projects yet"
            description="Create your first project and start organizing your team's work."
            action={canCreate && <Button variant="primary" size="sm" icon={Plus} onClick={onCreate}>Create project</Button>}
          />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {projects.map((p) => (
            <li key={p.id}>
              <Link to={`/projects/${p.id}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-3 py-2.5 hover:bg-canvas/70 sm:grid-cols-[minmax(0,1fr)_96px_160px_70px]">
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium">{p.name}</span>
                  <span className="block text-xs text-ink-subtle">
                    {p.stats.completed}/{p.stats.total} tasks{p.stats.overdue > 0 && <span className="text-danger-600"> · {p.stats.overdue} overdue</span>}
                  </span>
                </span>
                <StatusBadge map={PROJECT_STATUS} value={p.status} className="justify-self-end sm:justify-self-start" />
                <Progress value={p.stats.progress} label={`${p.name} progress`} className="col-span-2 sm:col-span-1" />
                <span className="hidden text-right sm:block">
                  <DueLabel date={p.dueDate} completed={p.status === 'COMPLETED'} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function WorkloadBlock({ workload }) {
  const max = Math.max(1, ...workload.map((w) => w.openTasks));
  return (
    <Section title="Team workload" id="dash-workload">
      <ul className="space-y-2.5 rounded-lg border border-line bg-surface p-3">
        {workload.map((w) => (
          <li key={w.id} className="flex items-center gap-2.5">
            <Avatar name={w.name} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate">{w.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                  {w.openTasks} open{w.overdueTasks > 0 && <span className="text-danger-600"> · {w.overdueTasks} late</span>}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                <div className={cn('h-full rounded-full', w.overdueTasks ? 'bg-warning-600' : 'bg-brand-500')} style={{ width: `${(w.openTasks / max) * 100}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PlanBlock({ subscription }) {
  const { can } = useAuth();
  const { plan, usage } = subscription;
  return (
    <Section title="Plan" id="dash-plan" action={<Link to="/billing" className="text-xs font-medium text-brand-700 hover:underline">Plan & billing</Link>}>
      <div className="space-y-3 rounded-lg border border-line bg-surface p-3">
        <div className="flex items-center justify-between">
          <span className="text-[13.5px] font-semibold">{plan.name}</span>
          {subscription.subscription?.currentPeriodEnd && (
            <span className="text-xs text-ink-muted">
              {subscription.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {formatDate(subscription.subscription.currentPeriodEnd)}
            </span>
          )}
        </div>
        <UsageMeter label="Team members" used={usage.users} limit={plan.maxUsers} />
        <UsageMeter label="Active projects" used={usage.projects} limit={plan.maxProjects} />
        {can('SUBSCRIPTION_MANAGE') && plan.maxUsers !== null && usage.users >= plan.maxUsers && (
          <ButtonLink to="/billing#plans" variant="accent" size="sm" className="w-full">
            Upgrade to add more members
          </ButtonLink>
        )}
      </div>
    </Section>
  );
}

function ActivityBlock({ activity }) {
  return (
    <Section title="Recent activity" id="dash-activity" action={<Link to="/activity" className="text-xs font-medium text-brand-700 hover:underline">View all</Link>}>
      {activity.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-3 py-6 text-center text-[13px] text-ink-subtle">No activity yet.</p>
      ) : (
        <ol className="rounded-lg border border-line bg-surface px-3 py-1">
          {activity.map((a) => (
            <ActivityItem key={a.id} activity={a} compact />
          ))}
        </ol>
      )}
    </Section>
  );
}

/** Placeholders shaped like the real dashboard: metric strip, project rows, side panels. */
function DashboardSkeleton() {
  const rows = (n, h = 'h-12') => Array.from({ length: n }, (_, i) => <Skeleton key={i} className={cn(h, 'w-full')} />);
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="space-y-2 bg-surface px-4 py-3">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-6 w-10" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-2">
          <Skeleton className="mb-3 h-3 w-32" />
          {rows(4)}
        </div>
        <div className="space-y-2">
          <Skeleton className="mb-3 h-3 w-20" />
          {rows(2, 'h-16')}
          <Skeleton className="mb-3 mt-5 h-3 w-28" />
          {rows(4, 'h-8')}
        </div>
      </div>
    </div>
  );
}

/** Side column only when it has something to show (employees get a single, full-width column). */
const hasSide = (d) => !!(d.subscription || d.workload?.length || d.recentActivity);

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const { user, workspace, can, canAny } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/dashboard') });

  // Organization-wide viewers (owners, admins, managers) lead with projects; individual
  // contributors lead with their own work.
  const orgView = can('PROJECT_VIEW_ALL');
  const canProjects = canAny('PROJECT_VIEW', 'PROJECT_VIEW_ALL');

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
            {greeting()}, {user.firstName}
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">Here's what's happening at {workspace.organization.name}.</p>
        </div>
        {can('PROJECT_CREATE') && (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New project
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <DashboardSkeleton />
      ) : (
        <>
          <MetricsStrip stats={data.stats} canProjects={canProjects} />
          <div className={cn('grid gap-6', hasSide(data) && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
            <div className="min-w-0 space-y-6">
              {orgView ? (
                <>
                  {data.projects && <ProjectsBlock projects={data.projects} canCreate={can('PROJECT_CREATE')} onCreate={() => setCreating(true)} />}
                  {data.myWork && <MyWorkBlock work={data.myWork} />}
                </>
              ) : (
                <>
                  {data.myWork && <MyWorkBlock work={data.myWork} />}
                  {data.projects && <ProjectsBlock projects={data.projects} canCreate={can('PROJECT_CREATE')} onCreate={() => setCreating(true)} />}
                </>
              )}
            </div>
            {hasSide(data) && <div className="min-w-0 space-y-6">
              {data.subscription && <PlanBlock subscription={data.subscription} />}
              {data.workload && data.workload.length > 0 && <WorkloadBlock workload={data.workload} />}
              {data.recentActivity && <ActivityBlock activity={data.recentActivity} />}
            </div>}
          </div>
        </>
      )}

      <ProjectFormModal open={creating} onOpenChange={setCreating} onCreated={(p) => navigate(`/projects/${p.id}`)} />
    </>
  );
}
