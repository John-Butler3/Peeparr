import { stashScreenshotUrl } from './stash-screenshot-url.util';

describe('stashScreenshotUrl', () => {
  it('carries Stash\'s screenshot version, so a new screenshot gets a new address', () => {
    expect(stashScreenshotUrl('218', 'http://stash:9999/scene/218/screenshot?t=1792094921')).toBe(
      '/api/media/stash/scenes/218/screenshot?v=1792094921',
    );
    expect(stashScreenshotUrl('218', 'http://stash:9999/scene/218/screenshot?apikey=x&t=17')).toBe(
      '/api/media/stash/scenes/218/screenshot?v=17',
    );
  });

  it('works without a version, and is null without a screenshot', () => {
    expect(stashScreenshotUrl('9', 'http://stash/scene/9/screenshot')).toBe('/api/media/stash/scenes/9/screenshot');
    expect(stashScreenshotUrl('9', null)).toBeNull();
  });
});
