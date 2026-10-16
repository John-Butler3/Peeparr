export interface HealthStatusResponse {
  status: string;
  database: string;
  service: string;
  /** Only when signed in. */
  version?: string;
}
