import { useState } from 'react';
import { MoreHorizontal, Mail, RotateCcw, SearchX, ShieldCheck, UserMinus, UserPlus, UserX, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useMemberResponsibilities, useMembers, useOrganization, useRemoveMember, useResendInvitation, useUpdateMember } from './api.js';
import { useRoles } from '../roles/api.js';
import { InviteMemberModal, ChangeRoleModal } from './MemberModals.jsx';
import { PageHeader, Toolbar } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { StatusBadge, Badge } from '../../components/ui/Badge.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { UsageMeter } from '../../components/ui/Progress.jsx';
import { FilterSelect, Pagination, SearchInput } from '../../components/ui/Misc.jsx';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/Menu.jsx';
import { ConfirmDialog } from '../../components/ui/Dialog.jsx';
import { EmptyState, ErrorState, PlanLimitNotice } from '../../components/feedback/States.jsx';
import { useUrlFilters } from '../../hooks/useUrlFilters.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { MEMBER_DISPLAY_STATUS, MEMBER_STATUS, memberDisplayStatus, options } from '../../lib/status.js';
import { formatDate, formatLongDate } from '../../lib/format.js';
import { cn } from '../../lib/cn.js';

const KEYS = ['search', 'roleId', 'status', 'page'];

export function TeamPage() {
  useDocumentTitle('Team');
  const { can, canAny, workspace } = useAuth();
  const { filters, setFilters, clear, active, activeCount } = useUrlFilters(KEYS);
  const { data, isLoading, isFetching, error, refetch } = useMembers({ ...filters, pageSize: 25 });
  const org = useOrganization();
  const roles = useRoles(canAny('ROLE_VIEW', 'USER_CREATE', 'USER_UPDATE'));
  const [inviting, setInviting] = useState(false);
  const [changingRole, setChangingRole] = useState(null);
  const [confirm, setConfirm] = useState(null); // { member, kind: 'deactivate' | 'revoke' }

  const update = useUpdateMember();
  const remove = useRemoveMember();
  const resend = useResendInvitation();

  const atLimit = org.data && org.data.plan.maxUsers !== null && org.data.usage.users >= org.data.plan.maxUsers;

  const canActOn = (m) => m.id !== workspace.membershipId && (m.role.key !== 'OWNER' || workspace.role.key === 'OWNER');

  const setStatus = (m, status) =>
    update.mutate(
      { id: m.id, status },
      {
        onSuccess: () => {
          toast.success(status === 'ACTIVE' ? `${m.name} reactivated` : `${m.name} deactivated`);
          setConfirm(null);
        },
        onError: (err) => {
          setConfirm(null);
          toast.error(err.message);
        },
      },
    );

  const resendTo = (m) =>
    resend.mutate(m.id, { onSuccess: () => toast.success(`New invitation link sent to ${m.email}`), onError: (e) => toast.error(e.message) });

  const statusCell = (m) => {
    const status = memberDisplayStatus(m);
    return (
      <span className="inline-flex items-center gap-1.5" title={status === 'PENDING' && m.invitation?.expiresAt ? `Link valid until ${formatLongDate(m.invitation.expiresAt)}` : undefined}>
        <StatusBadge map={MEMBER_DISPLAY_STATUS} value={status} />
        {status === 'EXPIRED' && can('USER_CREATE') && (
          <Button variant="link" className="text-xs" loading={resend.isPending && resend.variables === m.id} onClick={() => resendTo(m)}>
            Resend
          </Button>
        )}
      </span>
    );
  };

  const actions = (m) => {
    if (!canActOn(m)) return null;
    const items = [];
    if (can('USER_UPDATE') && m.status !== 'DEACTIVATED') items.push(<MenuItem key="role" icon={ShieldCheck} onSelect={() => setChangingRole(m)}>Change role</MenuItem>);
    if (can('USER_CREATE') && m.status === 'INVITED')
      items.push(
        <MenuItem key="resend" icon={Mail} onSelect={() => resendTo(m)}>
          Resend invitation
        </MenuItem>,
      );
    if (can('USER_UPDATE') && m.status === 'DEACTIVATED') items.push(<MenuItem key="react" icon={RotateCcw} onSelect={() => setStatus(m, 'ACTIVE')}>Reactivate</MenuItem>);
    const danger = [];
    if (can('USER_UPDATE') && m.status === 'ACTIVE') danger.push(<MenuItem key="deact" icon={UserX} tone="danger" onSelect={() => setConfirm({ member: m, kind: 'deactivate' })}>Deactivate</MenuItem>);
    if (can('USER_DELETE') && m.status === 'INVITED') danger.push(<MenuItem key="revoke" icon={UserMinus} tone="danger" onSelect={() => setConfirm({ member: m, kind: 'revoke' })}>Revoke invitation</MenuItem>);
    if (!items.length && !danger.length) return null;
    return (
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" icon={MoreHorizontal} aria-label={`Actions for ${m.name}`} />
        </MenuTrigger>
        <MenuContent>
          {items}
          {items.length > 0 && danger.length > 0 && <MenuSeparator />}
          {danger}
        </MenuContent>
      </Menu>
    );
  };

  const nameCell = (m) => (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={m.name} size="md" inactive={m.status === 'DEACTIVATED'} />
      <div className="min-w-0">
        <p className={cn('truncate font-medium', m.status === 'DEACTIVATED' && 'text-ink-muted')}>
          {m.name}
          {m.id === workspace.membershipId && <span className="ml-1.5 text-xs font-normal text-ink-subtle">(you)</span>}
        </p>
        <p className="truncate text-xs text-ink-subtle">{m.email}</p>
      </div>
    </div>
  );

  const columns = [
    { key: 'name', header: 'Name', className: 'w-auto', cell: nameCell },
    { key: 'title', header: 'Job title', className: 'w-44', hideBelow: 'xl', cell: (m) => <span className="text-ink-muted">{m.jobTitle ?? '—'}</span> },
    { key: 'role', header: 'Role', className: 'w-36', cell: (m) => <Badge tone={m.role.key === 'OWNER' ? 'accent' : 'brand'}>{m.role.name}</Badge> },
    { key: 'status', header: 'Status', className: 'w-44', cell: statusCell },
    { key: 'tasks', header: 'Open tasks', className: 'w-24 text-right', headerClassName: 'w-24 text-right', cell: (m) => <span className="tabular-nums text-ink-muted">{m.status === 'INVITED' ? '—' : m.openTaskCount}</span> },
    { key: 'joined', header: 'Joined', className: 'w-32', hideBelow: 'lg', cell: (m) => <span className="text-ink-muted">{m.joinedAt ? formatLongDate(m.joinedAt) : m.invitation?.expiresAt && !m.invitation.expired ? `Invite until ${formatDate(m.invitation.expiresAt)}` : '—'}</span> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'w-12 text-right', cell: actions },
  ];

  return (
    <>
      <PageHeader
        title="Team"
        description="People in your organization, their roles and access."
        actions={
          can('USER_CREATE') && (
            <Button variant="primary" icon={UserPlus} onClick={() => setInviting(true)}>
              Invite member
            </Button>
          )
        }
      />

      {org.data && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <UsageMeter label={`Seats on the ${org.data.plan.name} plan`} used={org.data.usage.users} limit={org.data.plan.maxUsers} className="w-full max-w-xs" />
          <span className="text-xs text-ink-subtle">Active members and pending invitations use a seat.</span>
        </div>
      )}
      {atLimit && can('USER_CREATE') && (
        <PlanLimitNotice
          code="SUBSCRIPTION_USER_LIMIT"
          message={`Your ${org.data.plan.name} plan supports up to ${org.data.plan.maxUsers} team members. Upgrade your plan to add more people.`}
          className="mb-4"
        />
      )}

      <Toolbar search={<SearchInput value={filters.search} onChange={(search) => setFilters({ search })} placeholder="Search by name or email…" className="w-full sm:w-64" label="Search team" />} activeCount={activeCount} onClear={clear}>
        {roles.data && (
          <FilterSelect label="Role" value={filters.roleId} onChange={(roleId) => setFilters({ roleId })} options={roles.data.map((r) => ({ value: r.id, label: r.name }))} allLabel="All roles" />
        )}
        <FilterSelect label="Status" value={filters.status} onChange={(status) => setFilters({ status })} options={options(MEMBER_STATUS)} allLabel="Any status" />
      </Toolbar>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !isLoading && data.items.length === 0 ? (
        active ? (
          <EmptyState icon={SearchX} title="No team members match this filter" description="Try a different name, role or status." action={<Button size="sm" onClick={clear}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={Users} title="It's just you so far" description="Invite colleagues to plan and track work together." />
        )
      ) : (
        <div className={cn('transition-opacity', isFetching && !isLoading && 'opacity-70')}>
          <DataTable
            caption="Team members"
            columns={columns}
            rows={data?.items ?? []}
            loading={isLoading}
            mobileRow={(m) => (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  {nameCell(m)}
                  {/* Status sits under the name on phones so it never squeezes the name. */}
                  {m.status !== 'ACTIVE' && <div className="mt-1 pl-[42px]">{statusCell(m)}</div>}
                </div>
                <Badge tone={m.role.key === 'OWNER' ? 'accent' : 'brand'}>{m.role.name}</Badge>
                {actions(m)}
              </div>
            )}
          />
          <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
        </div>
      )}

      <InviteMemberModal open={inviting} onOpenChange={setInviting} roles={roles.data ?? []} organization={org.data} />
      <ChangeRoleModal member={changingRole} onClose={() => setChangingRole(null)} roles={roles.data ?? []} />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.kind === 'revoke' ? 'Revoke invitation?' : `Deactivate ${confirm?.member.name}?`}
        description={
          confirm?.kind === 'revoke'
            ? `${confirm?.member.email} will no longer be able to join. The seat becomes available again.`
            : 'They will be signed out of this organization immediately. Their tasks and history are kept, and you can reactivate them later.'
        }
        confirmLabel={confirm?.kind === 'revoke' ? 'Revoke invitation' : 'Deactivate'}
        loading={update.isPending || remove.isPending}
        onConfirm={() =>
          confirm.kind === 'revoke'
            ? remove.mutate(confirm.member.id, {
                onSuccess: () => {
                  toast.success('Invitation revoked');
                  setConfirm(null);
                },
                onError: (err) => toast.error(err.message),
              })
            : setStatus(confirm.member, 'DEACTIVATED')
        }
      >
        {confirm?.kind === 'deactivate' && <Responsibilities memberId={confirm.member.id} />}
      </ConfirmDialog>
    </>
  );
}

/** F-02: deactivating someone releases them as branch manager and project lead — say so before it happens. */
function Responsibilities({ memberId }) {
  const { data } = useMemberResponsibilities(memberId);
  if (!data) return null;
  const { managedBranches, ledProjects, openTasks } = data;
  if (!managedBranches.length && !ledProjects.length && !openTasks) return null;
  return (
    <ul className="mt-3 list-disc space-y-1 rounded-md border border-line bg-slate-50 py-2 pl-7 pr-3 text-[12.5px] text-ink-muted">
      {managedBranches.length > 0 && <li>No longer manager of {managedBranches.map((b) => b.name).join(', ')}.</li>}
      {ledProjects.length > 0 && <li>No longer lead of {ledProjects.map((p) => p.name).join(', ')}.</li>}
      {openTasks > 0 && <li>{openTasks} unfinished task{openTasks === 1 ? '' : 's'} stay assigned to them — reassign as needed.</li>}
    </ul>
  );
}
