export class IntegrationResponseDto {
  type!: 'STASHDB' | 'FANSDB' | 'TPDB' | 'STASH' | 'WHISPARR';
  enabled!: boolean;
  status!: 'NOT_CONFIGURED' | 'CONFIGURED' | 'ERROR';
  name!: string | null;
  baseUrl!: string | null;
  hasApiKey!: boolean;
  lastHealthyAt!: string | null;
  lastErrorAt!: string | null;
  lastErrorMessage!: string | null;
}
