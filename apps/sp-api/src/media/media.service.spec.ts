import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { MediaService } from './media.service';

describe('MediaService', () => {
  const integrationFindUniqueMock = jest.fn();
  const openSceneScreenshotMock = jest.fn();
  const openStudioLogoMock = jest.fn();
  const openPerformerPhotoMock = jest.fn();
  const openGalleryCoverMock = jest.fn();
  const openImageThumbnailMock = jest.fn();
  const openImageFullMock = jest.fn();
  const getSceneStreamUrlMock = jest.fn();
  const getScenePreviewUrlMock = jest.fn();
  const getScenePlaybackInfoMock = jest.fn();
  const saveSceneProgressMock = jest.fn();
  let originalFetch: typeof fetch;
  const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();

  const prismaService = {
    integrationConfig: {
      findUnique: integrationFindUniqueMock,
    },
  } as unknown as PrismaService;

  const stashAdapter = {
    openSceneScreenshot: openSceneScreenshotMock,
    openStudioLogo: openStudioLogoMock,
    openPerformerPhoto: openPerformerPhotoMock,
    openGalleryCover: openGalleryCoverMock,
    openImageThumbnail: openImageThumbnailMock,
    openImageFull: openImageFullMock,
    getSceneStreamUrl: getSceneStreamUrlMock,
    getScenePreviewUrl: getScenePreviewUrlMock,
    getScenePlaybackInfo: getScenePlaybackInfoMock,
    saveSceneProgress: saveSceneProgressMock,
  } as unknown as StashAdapter;

  let service: MediaService;

  beforeAll(() => {
    originalFetch = global.fetch;
    Object.assign(global, { fetch: fetchMock });
  });

  afterAll(() => {
    Object.assign(global, { fetch: originalFetch });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MediaService(prismaService, stashAdapter);
  });

  it('returns a proxied scene screenshot using stash integration credentials', async () => {
    const body = Buffer.from([1, 2, 3]);

    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    openSceneScreenshotMock.mockResolvedValue({
      body,
      contentType: 'image/jpeg',
      contentLength: '128',
      cacheControl: 'public, max-age=300',
    });

    const result = await service.getStashSceneScreenshot('411');

    expect(integrationFindUniqueMock).toHaveBeenCalledWith({
      where: { type: 'STASH' },
    });
    expect(openSceneScreenshotMock).toHaveBeenCalledWith('411', {
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    expect(result).toEqual({
      body,
      contentType: 'image/jpeg',
      contentLength: '128',
      cacheControl: 'public, max-age=300',
    });
  });

  it('returns a proxied studio logo using stash integration credentials', async () => {
    const body = Buffer.from([4, 5, 6]);

    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local/base',
      apiKey: null,
    });
    openStudioLogoMock.mockResolvedValue({
      body,
      contentType: 'image/png',
      contentLength: null,
      cacheControl: null,
    });

    const result = await service.getStashStudioLogo('studio-1');

    expect(openStudioLogoMock).toHaveBeenCalledWith('studio-1', {
      baseUrl: 'http://stash.local/base',
      apiKey: null,
    });
    expect(result.contentType).toBe('image/png');
  });

  it('returns a proxied performer photo using stash integration credentials', async () => {
    const body = Buffer.from([7, 8, 9]);
    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    openPerformerPhotoMock.mockResolvedValue({
      body,
      contentType: 'image/jpeg',
      contentLength: null,
      cacheControl: null,
    });

    const result = await service.getStashPerformerPhoto('performer-1');

    expect(openPerformerPhotoMock).toHaveBeenCalledWith('performer-1', {
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    expect(result.body).toBe(body);
  });

  it('returns a proxied gallery cover using stash integration credentials', async () => {
    const body = Buffer.from([1, 2]);
    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    openGalleryCoverMock.mockResolvedValue({
      body,
      contentType: 'image/jpeg',
      contentLength: null,
      cacheControl: null,
    });

    const result = await service.getStashGalleryCover('gallery-1');

    expect(openGalleryCoverMock).toHaveBeenCalledWith('gallery-1', {
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    expect(result.body).toBe(body);
  });

  it('returns a proxied image thumbnail using stash integration credentials', async () => {
    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    openImageThumbnailMock.mockResolvedValue({
      body: Buffer.from([1]),
      contentType: 'image/jpeg',
      contentLength: null,
      cacheControl: null,
    });

    await service.getStashImageThumbnail('image-1');

    expect(openImageThumbnailMock).toHaveBeenCalledWith('image-1', {
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
  });

  it('returns a proxied full-resolution image using stash integration credentials', async () => {
    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    openImageFullMock.mockResolvedValue({
      body: Buffer.from([1]),
      contentType: 'image/jpeg',
      contentLength: null,
      cacheControl: null,
    });

    await service.getStashImageFull('image-1');

    expect(openImageFullMock).toHaveBeenCalledWith('image-1', {
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
  });

  it('throws not found when stash returns no matching media asset', async () => {
    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    openSceneScreenshotMock.mockResolvedValue(null);

    await expect(service.getStashSceneScreenshot('411')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws service unavailable when stash is not configured', async () => {
    integrationFindUniqueMock.mockResolvedValue(null);

    await expect(service.getStashStudioLogo('studio-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(openStudioLogoMock).not.toHaveBeenCalled();
  });

  describe('streamStashScene', () => {
    beforeEach(() => {
      integrationFindUniqueMock.mockResolvedValue({
        type: 'STASH',
        enabled: true,
        status: 'CONFIGURED',
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });
      getSceneStreamUrlMock.mockResolvedValue(
        'http://stash.local/scene/411/stream?apikey=secret',
      );
    });

    it('resolves the Stash URL once per scene, not per range request', async () => {
      const ok = () =>
        ({
          ok: true,
          status: 206,
          headers: new Headers({ 'content-type': 'video/mp4' }),
          body: null,
        }) as Response;
      fetchMock.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());

      await service.streamStashScene('411', 'bytes=0-99');
      await service.streamStashScene('411', 'bytes=100-199');

      expect(getSceneStreamUrlMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("proxies Stash's preview clip for previews", async () => {
      getScenePreviewUrlMock.mockResolvedValue(
        'http://stash.local/scene/411/preview?apikey=secret',
      );
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        body: null,
      } as Response);

      await service.streamStashScene('411', undefined, false, 'preview');

      expect(getSceneStreamUrlMock).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        'http://stash.local/scene/411/preview?apikey=secret',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('proxies a full response and forwards content headers', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'video/mp4',
          'content-length': '1000',
          'accept-ranges': 'bytes',
        }),
        body: null,
      } as Response);

      const result = await service.streamStashScene('411');

      expect(getSceneStreamUrlMock).toHaveBeenCalledWith('411', {
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://stash.local/scene/411/stream?apikey=secret',
        expect.objectContaining({ method: 'GET', headers: {} }),
      );
      expect(result.status).toBe(200);
      expect(result.headers).toEqual({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/mp4',
        'Content-Length': '1000',
      });
    });

    it('still sends a real GET to Stash for a HEAD probe, but returns no body', async () => {
      const cancel = jest.fn().mockResolvedValue(undefined);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'video/mp4',
          'accept-ranges': 'bytes',
        }),
        body: { cancel },
      } as unknown as Response);

      const result = await service.streamStashScene('411', undefined, true);

      // Never HEAD to Stash -- its HEAD support on this endpoint is
      // unverified, and playing the same file directly from Stash's own
      // player only ever exercises GET.
      expect(fetchMock).toHaveBeenCalledWith(
        'http://stash.local/scene/411/stream?apikey=secret',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.status).toBe(200);
      expect(result.body).toBeNull();
      expect(cancel).toHaveBeenCalled();
    });

    it('falls back to video/mp4 when Stash does not report a content type', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'accept-ranges': 'bytes' }),
        body: null,
      } as Response);

      const result = await service.streamStashScene('411');

      expect(result.headers['Content-Type']).toBe('video/mp4');
    });

    it('forwards the Range header and returns a partial-content response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 206,
        headers: new Headers({
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-99/1000',
          'accept-ranges': 'bytes',
        }),
        body: null,
      } as Response);

      const result = await service.streamStashScene('411', 'bytes=0-99');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://stash.local/scene/411/stream?apikey=secret',
        expect.objectContaining({
          method: 'GET',
          headers: { Range: 'bytes=0-99' },
        }),
      );
      expect(result.status).toBe(206);
      expect(result.headers['Content-Range']).toBe('bytes 0-99/1000');
    });

    it('throws not found when stash has no stream url for the scene', async () => {
      getSceneStreamUrlMock.mockResolvedValue(null);

      await expect(service.streamStashScene('411')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws bad gateway when stash returns an error status', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        body: null,
      } as Response);

      await expect(service.streamStashScene('411')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('throws bad gateway when the upstream request fails', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network down'));

      await expect(service.streamStashScene('411')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  describe('getScenePlaybackInfo', () => {
    beforeEach(() => {
      integrationFindUniqueMock.mockResolvedValue({
        type: 'STASH',
        enabled: true,
        status: 'CONFIGURED',
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });
    });

    it('returns resume position and duration for the scene', async () => {
      getScenePlaybackInfoMock.mockResolvedValue({
        resumeSeconds: 245.6,
        duration: 1800,
      });

      await expect(service.getScenePlaybackInfo('411')).resolves.toEqual({
        resumeSeconds: 245.6,
        duration: 1800,
      });
      expect(getScenePlaybackInfoMock).toHaveBeenCalledWith('411', {
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });
    });

    it('throws not found when stash has no matching scene', async () => {
      getScenePlaybackInfoMock.mockResolvedValue(null);

      await expect(service.getScenePlaybackInfo('411')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('saveScenePlaybackProgress', () => {
    it('forwards resume position and play duration to the adapter', async () => {
      integrationFindUniqueMock.mockResolvedValue({
        type: 'STASH',
        enabled: true,
        status: 'CONFIGURED',
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });

      await service.saveScenePlaybackProgress('411', 245.6, 1800);

      expect(saveSceneProgressMock).toHaveBeenCalledWith('411', 245.6, 1800, {
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });
    });
  });

  describe('lower qualities (Stash HLS)', () => {
    beforeEach(() => {
      integrationFindUniqueMock.mockResolvedValue({
        type: 'STASH',
        enabled: true,
        status: 'CONFIGURED',
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      });
      getSceneStreamUrlMock.mockResolvedValue(
        'http://stash.local/scene/12/stream?apikey=secret',
      );
    });

    it("rewrites Stash's playlist so its pieces come through here, with the stream token", async () => {
      // As Stash answers it.
      fetchMock.mockResolvedValueOnce(
        new Response(
          [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-TARGETDURATION:2',
            '#EXT-X-PLAYLIST-TYPE:VOD',
            '#EXTINF:2.000000,',
            '/scene/12/stream.m3u8/0.ts?resolution=STANDARD_HD&apikey=secret',
            '#EXTINF:2.000000,',
            '/scene/12/stream.m3u8/1.ts?resolution=STANDARD_HD&apikey=secret',
            '#EXT-X-ENDLIST',
          ].join('\n'),
          { status: 200 },
        ),
      );

      const playlist = await service.getSceneHlsPlaylist(
        '12',
        'STANDARD_HD',
        'tok.en',
      );

      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://stash.local/scene/12/stream.m3u8?apikey=secret&resolution=STANDARD_HD',
      );
      expect(playlist.split('\n')).toEqual([
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:2',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXTINF:2.000000,',
        'STANDARD_HD/0.ts?st=tok.en',
        '#EXTINF:2.000000,',
        'STANDARD_HD/1.ts?st=tok.en',
        '#EXT-X-ENDLIST',
      ]);
      // The API key never reaches the phone.
      expect(playlist).not.toContain('secret');
    });

    it('passes a piece through from Stash, and only ever a piece', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('ts-bytes', {
          status: 200,
          headers: { 'content-type': 'video/MP2T', 'content-length': '8' },
        }),
      );

      const piece = await service.streamSceneHlsSegment('12', 'LOW', '7.ts');
      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://stash.local/scene/12/stream.m3u8/7.ts?apikey=secret&resolution=LOW',
      );
      expect(piece.headers['Content-Type']).toBe('video/MP2T');
      expect(piece.headers['Content-Length']).toBe('8');

      await expect(
        service.streamSceneHlsSegment('12', 'LOW', '../stream'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
