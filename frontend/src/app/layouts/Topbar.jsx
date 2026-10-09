import { useNavigate } from 'react-router';
import { Building2, Check, ChevronsUpDown, LogOut, Menu as MenuIcon, Search, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../features/auth/AuthProvider.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../../components/ui/Menu.jsx';
import { api } from '../../lib/api.js';

/** Workspace switcher: a static name for single-workspace users, a menu when there are several. */
function WorkspaceSwitcher() {
  const { me, workspace, applySession } = useAuth();
  const navigate = useNavigate();
  if (!workspace) return <span className="truncate text-[13px] font-semibold text-ink">TeamFlow Platform</span>;

  const name = workspace.organization.name;
  if (me.memberships.length < 2) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Building2 size={15} className="shrink-0 text-ink-subtle" aria-hidden="true" />
        <span className="truncate text-[13px] font-semibold">{name}</span>
      </span>
    );
  }

  const switchTo = async (id) => {
    try {
      applySession(await api.post('/auth/switch-workspace', { membershipId: id }));
      navigate('/');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Menu>
      <MenuTrigger className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-canvas">
        <Building2 size={15} className="shrink-0 text-ink-subtle" aria-hidden="true" />
        <span className="truncate text-[13px] font-semibold">{name}</span>
        <ChevronsUpDown size={13} className="shrink-0 text-ink-subtle" aria-hidden="true" />
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Switch workspace</MenuLabel>
        {me.memberships.map((m) => (
          <MenuItem key={m.id} onSelect={() => m.id !== workspace.membershipId && switchTo(m.id)}>
            <span className="flex-1 truncate">{m.organization.name}</span>
            {m.id === workspace.membershipId && <Check size={14} className="text-brand-600" aria-label="Current" />}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

export function Topbar({ onOpenNav, onOpenSearch, showSearch }) {
  const { user, workspace, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:px-4">
      <Button variant="ghost" size="icon" icon={MenuIcon} aria-label="Open navigation" onClick={onOpenNav} className="-ml-1 lg:hidden" />
      <div className="min-w-0 flex-1">
        <WorkspaceSwitcher />
      </div>

      {showSearch && (
        <>
          <button
            type="button"
            onClick={onOpenSearch}
            className="hidden h-8 w-64 items-center gap-2 rounded-md border border-line-strong bg-canvas px-2.5 text-[13px] text-ink-subtle transition-colors hover:border-ink-subtle/40 md:flex"
          >
            <Search size={14} aria-hidden="true" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="rounded border border-line bg-surface px-1 text-[10.5px]">Ctrl K</kbd>
          </button>
          <Button variant="ghost" size="icon" icon={Search} aria-label="Search" onClick={onOpenSearch} className="md:hidden" />
        </>
      )}

      <Menu>
        <MenuTrigger className="flex items-center gap-2 rounded-md p-1 hover:bg-canvas">
          <Avatar name={user.name} size="md" />
          <span className="sr-only max-w-36 text-left leading-tight xl:not-sr-only xl:block">
            <span className="block truncate text-[13px] font-medium">{user.name}</span>
            <span className="block truncate text-[11px] text-ink-subtle">{workspace?.role.name ?? 'Platform admin'}</span>
            <span className="sr-only">, account menu</span>
          </span>
        </MenuTrigger>
        <MenuContent className="w-60">
          <div className="px-2 py-1.5">
            <p className="truncate text-[13px] font-medium">{user.name}</p>
            <p className="truncate text-xs text-ink-subtle">{user.email}</p>
            {workspace && <p className="mt-1 text-xs text-ink-muted">{workspace.role.name} · {workspace.organization.name}</p>}
          </div>
          <MenuSeparator />
          <MenuItem icon={Settings} onSelect={() => navigate('/settings')}>
            Profile & settings
          </MenuItem>
          <MenuItem icon={LogOut} onSelect={() => signOut().then(() => navigate('/login'))}>
            Sign out
          </MenuItem>
        </MenuContent>
      </Menu>
    </header>
  );
}
