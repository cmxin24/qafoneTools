let activeCloseGuard: string | null = null;

export function claimCloseGuard(owner: string): boolean {
  if (activeCloseGuard && activeCloseGuard !== owner) return false;
  activeCloseGuard = owner;
  return true;
}

export function releaseCloseGuard(owner: string) {
  if (activeCloseGuard === owner) activeCloseGuard = null;
}
