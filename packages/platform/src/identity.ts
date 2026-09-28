import { NotImplementedError, type ISODateString, type UUID } from "@sport-os/shared";

/**
 * Internal identity anchored to a Telegram user (Section 01 — Licensing
 * Foundation). The Telegram user id is an identity ANCHOR, not a secret —
 * it is safe to see in the frontend. It is never, by itself, treated as
 * authenticated: `IdentityService.resolve` only returns an Identity after
 * the caller has already validated the Telegram initData signature (see
 * @sport-os/telegram's validateInitData) — server-side verification is
 * the actual security boundary, per Security Principle 3.
 */
export interface Identity {
  readonly userId: UUID;
  readonly telegramUserId: number;
  readonly telegramUsername: string | undefined;
  readonly createdAt: ISODateString;
}

/**
 * IdentityService — resolves a validated Telegram user into an internal
 * Identity. Deferred: requires persistence, which is a Section 03
 * (database) concern.
 */
export interface IdentityService {
  resolve(telegramUserId: number): Promise<Identity | undefined>;
  resolveOrCreate(telegramUserId: number, telegramUsername: string | undefined): Promise<Identity>;
}

export class NotImplementedIdentityService implements IdentityService {
  async resolve(_telegramUserId: number): Promise<Identity | undefined> {
    throw new NotImplementedError("IdentityService.resolve");
  }
  async resolveOrCreate(_telegramUserId: number, _telegramUsername: string | undefined): Promise<Identity> {
    throw new NotImplementedError("IdentityService.resolveOrCreate");
  }
}
