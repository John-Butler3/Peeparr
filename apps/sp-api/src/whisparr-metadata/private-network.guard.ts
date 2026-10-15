import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';

/**
 * The metadata routes have no login (Whisparr can't sign in) but use the
 * catalog's API key, so only answer callers on a private network: this
 * machine, home and container networks, and VPN ranges. The address comes
 * from the connection itself, never a header like X-Forwarded-For, so it
 * can't be faked. PEEPARR_METADATA_ALLOW_ANY_NETWORK=true turns this off.
 */
@Injectable()
export class PrivateNetworkGuard implements CanActivate {
  private static readonly PRIVATE = (() => {
    const list = new BlockList();
    list.addSubnet('127.0.0.0', 8, 'ipv4'); // this machine
    list.addSubnet('10.0.0.0', 8, 'ipv4');
    list.addSubnet('172.16.0.0', 12, 'ipv4'); // includes Docker's networks
    list.addSubnet('192.168.0.0', 16, 'ipv4');
    list.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT, Tailscale
    list.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local
    list.addAddress('::1', 'ipv6');
    list.addSubnet('fc00::', 7, 'ipv6'); // unique local
    list.addSubnet('fe80::', 10, 'ipv6'); // link-local
    return list;
  })();

  canActivate(context: ExecutionContext): boolean {
    if (process.env.PEEPARR_METADATA_ALLOW_ANY_NETWORK?.trim().toLowerCase() === 'true') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (PrivateNetworkGuard.isPrivate(request.socket.remoteAddress)) {
      return true;
    }
    throw new ForbiddenException('Only available on your private network.');
  }

  static isPrivate(address: string | undefined): boolean {
    if (!address) {
      return false;
    }
    // IPv4 seen through an IPv6 socket: ::ffff:192.168.1.5
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    const ip = mapped ?? address;
    const family = isIP(ip);
    if (family === 0) {
      return false;
    }
    return PrivateNetworkGuard.PRIVATE.check(ip, family === 4 ? 'ipv4' : 'ipv6');
  }
}
