import { useNavigate } from 'react-router';
import { LogOut, Menu as MenuIcon, Search, Settings } from 'lucide-react';
import { useAuth } from '../../features/auth/AuthProvider.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/Menu.jsx';
import { OrganizationSwitcher } from '../../features/organizations/OrganizationSwitcher.jsx';
import { usePlatformAdmin } from '../../features/platform/PlatformAuth.jsx';

/** Platform admins have no workspace; everyone else gets the organization switcher. */
function WorkspaceSwitcher() {
  const { workspace } = useAuth();
  if (!workspace) return <span className="truncate text-[13px] font-semibold text-ink">TeamFlow Platform</span>;
  return <OrganizationSwitcher />;
}

export function Topbar({ onOpenNav, onOpenSearch, showSearch, platform = false }) {
  const auth = useAuth();
  const platformSession = usePlatformAdmin();
  const navigate = useNavigate();
  // The platform console has its own identity and session (see PlatformAuth.jsx).
  const user = platform ? platformSession.admin : auth.user;
  const workspace = platform ? null : auth.workspace;
  const signOut = platform ? platformSession.signOut : () => auth.signOut().then(() => navigate('/login'));

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
          {!platform && (
            <MenuItem icon={Settings} onSelect={() => navigate('/settings')}>
              Profile & settings
            </MenuItem>
          )}
          <MenuItem icon={LogOut} onSelect={signOut}>
            Sign out
          </MenuItem>
        </MenuContent>
      </Menu>
    </header>
  );
}
