import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { chmod, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface PendingReset {
  passwordHash: string;
  issuedAt: number;
  expiresAt: number;
}

// Unambiguous characters only (no 0/O, 1/I/L) so the password is easy to
// copy by hand from a terminal.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * "Forgot password" support for the single admin account.
 *
 * Requesting a reset never touches the stored password, so anyone who can
 * reach the sign-in page cannot lock the admin out. It issues a short-lived,
 * single-use temporary password and writes it to a root-only file inside the
 * app data volume, readable only from the host shell:
 *
 *   docker exec <app-container> stasharr-reset-password
 *
 * Signing in with it makes it the account password (and signs out every other
 * session), after which the admin is sent to change it.
 */
@Injectable()
export class PasswordResetService implements OnModuleInit {
  static readonly TTL_MS = 15 * 60 * 1000;
  static readonly REISSUE_COOLDOWN_MS = 60 * 1000;

  private readonly logger = new Logger(PasswordResetService.name);
  private pending: PendingReset | null = null;

  filePath = join(
    process.env.APP_DATA_DIR ?? '/var/lib/stasharr',
    'password-reset.txt',
  );

  async onModuleInit(): Promise<void> {
    // Pending resets live in memory only; a file left over from before a
    // restart no longer works, so don't leave it lying around.
    await this.removeFile();
  }

  async issue(username: string, now = Date.now()): Promise<void> {
    if (
      this.pending &&
      now - this.pending.issuedAt < PasswordResetService.REISSUE_COOLDOWN_MS
    ) {
      return;
    }

    const password = generateTemporaryPassword();
    const expiresAt = now + PasswordResetService.TTL_MS;

    await writeFile(
      this.filePath,
      [
        'Stasharr temporary password',
        '',
        `Username: ${username}`,
        `Password: ${password}`,
        `Expires:  ${new Date(expiresAt).toISOString()} (single use)`,
        '',
        'Sign in with it, then set a new password in Settings > Account.',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    await chmod(this.filePath, 0o600);

    this.pending = {
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      issuedAt: now,
      expiresAt,
    };
    this.logger.warn(
      `Password reset requested; temporary password written to ${this.filePath}`,
    );
  }

  /**
   * Returns the temporary password's hash when `password` matches an
   * unexpired reset, otherwise null.
   */
  async verify(password: string, now = Date.now()): Promise<string | null> {
    const pending = this.pending;
    if (!pending) {
      return null;
    }

    if (now >= pending.expiresAt) {
      await this.clear();
      return null;
    }

    return (await argon2.verify(pending.passwordHash, password))
      ? pending.passwordHash
      : null;
  }

  async clear(): Promise<void> {
    this.pending = null;
    await this.removeFile();
  }

  private async removeFile(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let group = 0; group < 4; group += 1) {
    let chunk = '';
    for (let index = 0; index < 4; index += 1) {
      chunk += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(chunk);
  }

  return groups.join('-');
}
