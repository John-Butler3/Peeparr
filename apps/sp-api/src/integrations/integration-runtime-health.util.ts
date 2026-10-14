import {
  IntegrationType,
  RuntimeHealthServiceKey,
} from '@prisma/client';

const INTEGRATION_RUNTIME_HEALTH_SERVICE_MAP: Record<
  IntegrationType,
  RuntimeHealthServiceKey
> = {
  [IntegrationType.STASH]: RuntimeHealthServiceKey.STASH,
  [IntegrationType.WHISPARR]: RuntimeHealthServiceKey.WHISPARR,
  [IntegrationType.STASHDB]: RuntimeHealthServiceKey.CATALOG,
  [IntegrationType.FANSDB]: RuntimeHealthServiceKey.CATALOG,
  [IntegrationType.TPDB]: RuntimeHealthServiceKey.CATALOG,
};

export function runtimeHealthServiceForIntegration(
  type: IntegrationType,
): RuntimeHealthServiceKey {
  return INTEGRATION_RUNTIME_HEALTH_SERVICE_MAP[type];
}
