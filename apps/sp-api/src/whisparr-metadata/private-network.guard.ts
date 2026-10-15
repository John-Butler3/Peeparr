import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { isFromPrivateNetwork, isPrivateAddress } from '../security/http-security';

/**
 * The metadata routes have no login (Whisparr can't sign in) but use the
 * catalog's API key, so only answer callers on a private network: this
 * machine, home and container networks, and VPN ranges. Never judged from
 * headers a client can fake; behind a reverse proxy, only the client
 * address a trusted proxy reports (PEEPARR_TRUST_PROXY) counts, so the
 * internet can't reach these through the proxy.
 * PEEPARR_METADATA_ALLOW_ANY_NETWORK=true turns this off.
 */
@Injectable()
export class PrivateNetworkGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (process.env.PEEPARR_METADATA_ALLOW_ANY_NETWORK?.trim().toLowerCase() === 'true') {
      return true;
    }
    if (isFromPrivateNetwork(context.switchToHttp().getRequest<Request>())) {
      return true;
    }
    throw new ForbiddenException('Only available on your private network.');
  }

  static isPrivate(address: string | undefined): boolean {
    return isPrivateAddress(address);
  }
}
