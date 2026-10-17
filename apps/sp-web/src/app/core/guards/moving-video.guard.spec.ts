import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { PageFadeService } from '../navigation/page-fade.service';
import { SharedVideoService } from '../player/shared-video.service';
import { fadeOutUnderMovingVideoGuard } from './moving-video.guard';

describe('fadeOutUnderMovingVideoGuard', () => {
  afterEach(() => TestBed.resetTestingModule());

  function run(playing: boolean) {
    const fadeOut = vi.fn(() => Promise.resolve());
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SharedVideoService,
          useValue: { isLifted: () => false, liftIfPlaying: () => playing },
        },
        { provide: PageFadeService, useValue: { fadeOut } },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      fadeOutUnderMovingVideoGuard(
        {},
        {} as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
        {} as RouterStateSnapshot,
      ),
    );
    return { result, fadeOut };
  }

  it('fades the page out under a playing video, then lets the page change go ahead', async () => {
    const { result, fadeOut } = run(true);
    await expect(result).resolves.toBe(true);
    expect(fadeOut).toHaveBeenCalled();
  });

  it('just lets it go ahead otherwise', async () => {
    const { result, fadeOut } = run(false);
    await expect(result).resolves.toBe(true);
    expect(fadeOut).not.toHaveBeenCalled();
  });
});
