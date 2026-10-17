import { TestBed } from '@angular/core/testing';
import { VideoQualityService } from './video-quality.service';

describe('VideoQualityService', () => {
  const source = {
    streamUrl: '/api/media/stash/scenes/412/stream?st=a.b.c.d',
    stashSceneId: '412',
    resumeSeconds: 0,
    duration: null,
  };

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  function service(hls: boolean): VideoQualityService {
    const created = TestBed.inject(VideoQualityService);
    Object.defineProperty(created, 'available', { value: hls });
    return created;
  }

  it("plays the original until a lower quality is chosen, then Stash's HLS at it", () => {
    const quality = service(true);
    expect(quality.apply(source).streamUrl).toBe(source.streamUrl);

    quality.set('STANDARD_HD');
    expect(quality.apply(source).streamUrl).toBe(
      '/api/media/stash/scenes/412/hls/STANDARD_HD.m3u8?st=a.b.c.d',
    );
    // Kept for this device.
    expect(localStorage.getItem('peeparr.videoQuality')).toBe('STANDARD_HD');
  });

  it("is always the original where HLS can't play", () => {
    const quality = service(false);
    quality.set('LOW');
    expect(quality.apply(source).streamUrl).toBe(source.streamUrl);
  });
});
