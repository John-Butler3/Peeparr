// Peeparr was called Stasharr. Settings still named STASHARR_* (in an
// existing .env or compose file) keep working: each one fills in its
// PEEPARR_* name unless that's set too. Imported first in main.ts.
const LEGACY_PREFIX = 'STASHARR_';
const PREFIX = 'PEEPARR_';

export function applyLegacyEnvNames(env: NodeJS.ProcessEnv = process.env): void {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(LEGACY_PREFIX) || value === undefined) {
      continue;
    }
    const current = `${PREFIX}${name.slice(LEGACY_PREFIX.length)}`;
    if (env[current] === undefined) {
      env[current] = value;
    }
  }
}

applyLegacyEnvNames();
