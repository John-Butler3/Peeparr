import { IsIn } from 'class-validator';
import type { StashScanTarget } from '../../providers/stash/stash.adapter';

export const STASH_SCAN_TARGETS: readonly StashScanTarget[] = [
  'library',
  'galleries',
];

export class StartStashScanDto {
  /** What to scan for: new videos ('library') or new images ('galleries'). */
  @IsIn(STASH_SCAN_TARGETS)
  target!: StashScanTarget;
}

export class StashScanStartedDto {
  target!: StashScanTarget;
  /** Stash's id for the queued job. */
  jobId!: string;
  /** The library folders being scanned; empty means all of them. */
  paths!: string[];
}
