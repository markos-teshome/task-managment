import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, ArrowLeft, FolderKanban, MoreHorizontal, Pencil, Star, UserMinus, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useAddBranchMembers, useBranch, useRemoveBranchMember, useUpdateBranch } from './api.js';
import { useProjects } from '../projects/api.js';
import { BranchFormModal } from './BranchFormModal.jsx';
import { ArchiveBranchDialog, ReactivateBranchDialog } from './BranchDialogs.jsx';
import { MemberPicker } from '../team/MemberPicker.jsx';
import { Section } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Badge, StatusBadge } from '../../components/ui/Badge.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Progress } from '../../components/ui/Progress.jsx';
import { Pagination, Skeleton } from '../../components/ui/Misc.jsx';
import { onIntent, prefetchProject } from '../../app/preload.js';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/Menu.jsx';
import { ConfirmDialog, Modal, DialogBody, DialogFooter, DialogClose } from '../../components/ui/Dialog.jsx';
import { FormAlert } from '../../components/ui/Form.jsx';
import { EmptyState, ErrorState } from '../../components/feedback/States.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { BRANCH_STATUS, PROJECT_STATUS } from '../../lib/status.js';
import { formatLongDate } from '../../lib/format.js';

/**
 * One branch: who runs it, who works there and which projects belong to it. Everything shown comes from the
 * server, already limited to what the viewer may see (projects of other branches never appear).
 */
export function BranchDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: branch, isLoading, error, refetch } = useBranch(id);
  useDocumentTitle(branch?.name ?? 'Branch');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const setDefault = useUpdateBranch(id);

  if (error) {
    return (
      <>
        <BackLink />
        <ErrorState error={error} onRetry={error.status === 404 ? undefined : refetch} title={error.status === 404 ? 'Branch not found' : undefined} />
      </>
    );
  }
  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading branch">
        <BackLink />
        <Skeleton className="mb-2 h-6 w-56" />
        <Skeleton className="mb-6 h-4 w-80 max-w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const manageAll = can('BRANCH_MANAGE');
  const active = branch.status === 'ACTIVE';
  const canEditMembers = branch.canManage && active;

  return (
    <>
      <BackLink />
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{branch.name}</h1>
            {branch.code && <span className="rounded bg-slate-100 px-1.5 font-mono text-[11px] text-ink-muted">{branch.code}</span>}
            {branch.isDefault && <Badge tone="brand" icon={Star}>Default</Badge>}
            <StatusBadge map={BRANCH_STATUS} value={branch.status} />
          </div>
          {branch.description && <p className="mt-1 max-w-3xl text-[13px] text-ink-muted">{branch.description}</p>}
        </div>
        {branch.canManage && (
          <div className="flex items-center gap-2">
            {active && (
              <Button icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {manageAll && (!branch.isDefault || !active) && (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="icon" icon={MoreHorizontal} aria-label="More branch actions" />
                </MenuTrigger>
                <MenuContent align="end">
                  {active && !branch.isDefault && (
                    <MenuItem
                      icon={Star}
                      onSelect={() => setDefault.mutate({ isDefault: true }, { onSuccess: () => toast.success(`${branch.name} is now the default branch`), onError: (e) => toast.error(e.message) })}
                    >
                      Make default
                    </MenuItem>
                  )}
                  {active && !branch.isDefault && <MenuItem icon={Archive} tone="danger" onSelect={() => setArchiving(true)}>Archive branch</MenuItem>}
                  {!active && <MenuItem icon={ArchiveRestore} onSelect={() => setReactivating(true)}>Reactivate</MenuItem>}
                </MenuContent>
              </Menu>
            )}
          </div>
        )}
      </header>

      {/* Key facts in one compact strip rather than a wall of cards. */}
      <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-[13px] sm:grid-cols-4">
        <Fact label="Manager">{branch.manager?.name ?? <span className="text-ink-subtle">Not assigned</span>}</Fact>
        <Fact label="Members">{branch.memberCount}</Fact>
        <Fact label="Active projects">{branch.activeProjectCount}</Fact>
        <Fact label={branch.address ? 'Address' : 'Created'}>{branch.address ?? formatLongDate(branch.createdAt)}</Fact>
      </dl>

      {!active && (
        <p className="mb-4 rounded-md border border-line bg-slate-50 px-3 py-2 text-[13px] text-ink-muted">
          This branch was archived on {formatLongDate(branch.archivedAt)}. Its history is kept; it accepts no new members or projects.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section
          title={`Members · ${branch.members.length}`}
          id="branch-members"
          action={
            canEditMembers && (
              <Button size="sm" icon={UserPlus} onClick={() => setAdding(true)}>
                Add members
              </Button>
            )
          }
        >
          <p className="mb-2 text-xs text-ink-subtle">
            Branch members are people of your organization who work here. Removing someone from a branch keeps their organization account.
          </p>
          {branch.members.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface">
              <EmptyState compact icon={Users} title="No members yet" description={canEditMembers ? 'Add the people who work at this branch.' : undefined} />
            </div>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {branch.members.map((m) => (
                <li key={m.membershipId} className="flex items-center gap-2.5 px-3 py-2">
                  <Avatar name={m.name} size="md" inactive={m.status !== 'ACTIVE'} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {m.name}
                      {branch.manager?.id === m.membershipId && <span className="ml-1.5 text-xs font-normal text-ink-subtle">· Manager</span>}
                    </p>
                    <p className="truncate text-xs text-ink-subtle">{m.jobTitle ?? m.email}</p>
                  </div>
                  <Badge tone={m.role.key === 'OWNER' ? 'accent' : 'brand'}>{m.role.name}</Badge>
                  {canEditMembers && branch.manager?.id !== m.membershipId && (
                    <Button variant="ghost" size="icon-sm" icon={UserMinus} aria-label={`Remove ${m.name} from ${branch.name}`} onClick={() => setRemoving(m)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <BranchProjects branchId={id} />
      </div>

      <BranchFormModal open={editing} onOpenChange={setEditing} branch={branch} managerOnly={!manageAll} />
      <AddMembersModal branch={branch} open={adding} onOpenChange={setAdding} />
      <RemoveMemberDialog branch={branch} member={removing} onClose={() => setRemoving(null)} />
      <ArchiveBranchDialog branch={archiving ? branch : null} onClose={() => setArchiving(false)} />
      <ReactivateBranchDialog branch={reactivating ? branch : null} onClose={() => setReactivating(false)} />
    </>
  );
}

const BackLink = () => (
  <Link to="/branches" className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-brand-700">
    <ArrowLeft size={14} aria-hidden="true" /> Branches
  </Link>
);

function Fact({ label, children }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 truncate font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** The branch's projects that the viewer may see (the API applies branch and role scope). */
function BranchProjects({ branchId }) {
  const { canAny } = useAuth();
  const allowed = canAny('PROJECT_VIEW', 'PROJECT_VIEW_ALL');
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useProjects({ branchId, page, pageSize: 10, sort: 'name', order: 'asc' }, { enabled: allowed });
  if (!allowed) return null;
  return (
    <Section title={`Projects${data ? ` · ${data.meta.total}` : ''}`} id="branch-projects">
      {error ? (
        <ErrorState compact error={error} onRetry={refetch} />
      ) : isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : data.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState compact icon={FolderKanban} title="No projects here" description="Projects created for this branch appear here." />
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {data.items.map((p) => (
            <li key={p.id} className="px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <Link to={`/projects/${p.id}`} {...onIntent(() => prefetchProject(p.id))} className="min-w-0 truncate text-[13px] font-medium hover:text-brand-700 hover:underline">
                  {p.name}
                </Link>
                <StatusBadge map={PROJECT_STATUS} value={p.status} />
              </div>
              <Progress value={p.stats.progress} className="mt-1.5" label={`${p.name} progress`} />
            </li>
          ))}
        </ul>
      )}
      <Pagination meta={data?.meta} onPageChange={setPage} />
    </Section>
  );
}

function AddMembersModal({ branch, open, onOpenChange }) {
  const add = useAddBranchMembers(branch.id);
  const [ids, setIds] = useState([]);
  const [error, setError] = useState(null);
  const close = (next) => {
    if (!next) {
      setIds([]);
      setError(null);
    }
    onOpenChange(next);
  };
  return (
    <Modal open={open} onOpenChange={close} title={`Add members to ${branch.name}`} description="People can work in several branches. Only members of your organization are listed." size="sm">
      <DialogBody className="space-y-3">
        <FormAlert>{error?.message}</FormAlert>
        <MemberPicker value={ids} onChange={setIds} exclude={branch.members.map((m) => m.membershipId)} label="Branch members" />
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button>Cancel</Button>
        </DialogClose>
        <Button
          variant="primary"
          disabled={!ids.length}
          loading={add.isPending}
          onClick={() => add.mutate(ids, { onSuccess: () => (toast.success(`${ids.length} added to ${branch.name}`), close(false)), onError: setError })}
        >
          Add {ids.length || ''}
        </Button>
      </DialogFooter>
    </Modal>
  );
}

function RemoveMemberDialog({ branch, member, onClose }) {
  const remove = useRemoveBranchMember(branch.id);
  return (
    <ConfirmDialog
      open={!!member}
      onOpenChange={(o) => !o && onClose()}
      title={`Remove ${member?.name} from ${branch.name}?`}
      description="They stay a member of your organization with the same role; only their place in this branch changes."
      confirmLabel="Remove from branch"
      loading={remove.isPending}
      onConfirm={() => remove.mutate(member.membershipId, { onSuccess: () => (toast.success(`${member.name} removed from ${branch.name}`), onClose()), onError: (e) => toast.error(e.message) })}
    />
  );
}
