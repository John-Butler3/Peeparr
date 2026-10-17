import { pornhubEmbedUrl } from './pornhub-embed.util';

describe('pornhubEmbedUrl', () => {
  it("makes Pornhub's embed URL from a video page link", () => {
    expect(
      pornhubEmbedUrl([
        { url: 'https://www.pornhub.com/view_video.php?viewkey=6862ef426715d' },
      ]),
    ).toBe('https://www.pornhub.com/embed/6862ef426715d');
    expect(
      pornhubEmbedUrl([
        { url: 'https://pornhub.com/view_video.php?viewkey=ph5f288f27015ef' },
      ]),
    ).toBe('https://www.pornhub.com/embed/ph5f288f27015ef');
    // Country subdomains and embed links.
    expect(
      pornhubEmbedUrl([
        {
          url: 'https://nz.pornhub.com/view_video.php?viewkey=ph60b277a2ba6a1',
        },
      ]),
    ).toBe('https://www.pornhub.com/embed/ph60b277a2ba6a1');
    expect(
      pornhubEmbedUrl([{ url: 'https://www.pornhub.com/embed/648842fabd2e1' }]),
    ).toBe('https://www.pornhub.com/embed/648842fabd2e1');
  });

  it('finds it among other links, and nothing otherwise', () => {
    expect(
      pornhubEmbedUrl([
        { url: 'https://studio.example/scene/1' },
        { url: 'https://www.pornhub.com/view_video.php?viewkey=648842fabd2e1' },
      ]),
    ).toBe('https://www.pornhub.com/embed/648842fabd2e1');
    expect(
      pornhubEmbedUrl([{ url: 'https://studio.example/scene/1' }]),
    ).toBeNull();
    expect(pornhubEmbedUrl([])).toBeNull();
  });

  it("doesn't trust lookalikes or odd keys", () => {
    for (const url of [
      'https://pornhub.com.evil.example/view_video.php?viewkey=abcdef123',
      'https://evilpornhub.com/view_video.php?viewkey=abcdef123',
      'https://www.pornhub.com/view_video.php?viewkey=abc"><script>',
      'https://www.pornhub.com/view_video.php?viewkey=a',
      'not a url',
    ]) {
      expect(pornhubEmbedUrl([{ url }])).toBeNull();
    }
  });
});
