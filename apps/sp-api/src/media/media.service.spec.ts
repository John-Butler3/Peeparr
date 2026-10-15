import sharp from 'sharp';
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

  describe('screenshot thumbnails', () => {
    const stash = {
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    };

    async function jpeg(width: number, height: number): Promise<Buffer> {
      return sharp({ create: { width, height, channels: 3, background: '#336699' } })
        .jpeg({ quality: 95 })
        .toBuffer();
    }

    it('sends a smaller WebP copy when a card asks for a width', async () => {
      const original = await jpeg(1920, 1080);
      integrationFindUniqueMock.mockResolvedValue(stash);
      openSceneScreenshotMock.mockResolvedValue({
        body: original,
        contentType: 'image/jpeg',
        contentLength: String(original.byteLength),
        cacheControl: 'private, max-age=31536000, immutable',
      });

      const result = await service.getStashSceneScreenshot('411', 640);

      expect(result.contentType).toBe('image/webp');
      expect(result.cacheControl).toBe('private, max-age=86400');
      const meta = await sharp(result.body).metadata();
      expect(meta).toMatchObject({ format: 'webp', width: 640, height: 360 });
      expect(result.contentLength).toBe(String(result.body.byteLength));
    });

    it('reuses a resized copy instead of resizing again', async () => {
      const original = await jpeg(1280, 720);
      integrationFindUniqueMock.mockResolvedValue(stash);
      openSceneScreenshotMock.mockResolvedValue({
        body: original,
        contentType: 'image/jpeg',
        contentLength: null,
        cacheControl: null,
      });

      const first = await service.getStashSceneScreenshot('411', 320);
      const second = await service.getStashSceneScreenshot('411', 320);

      expect(second.body).toBe(first.body);
    });

    it('sends the original for widths not on offer, or anything it cannot read', async () => {
      const body = Buffer.from('not an image');
      integrationFindUniqueMock.mockResolvedValue(stash);
      openSceneScreenshotMock.mockResolvedValue({
        body,
        contentType: 'image/jpeg',
        contentLength: '12',
        cacheControl: null,
      });

      expect((await service.getStashSceneScreenshot('411', 500)).body).toBe(body);
      expect((await service.getStashSceneScreenshot('411', 640)).body).toBe(body);
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
      getScenePreviewUrlMock.mockResolvedValue('http://stash.local/scene/411/preview?apikey=secret');
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
        headers: new Headers({ 'content-type': 'video/mp4', 'accept-ranges': 'bytes' }),
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
        expect.objectContaining({ method: 'GET', headers: { Range: 'bytes=0-99' } }),
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

      expect(saveSceneProgressMock).toHaveBeenCalledWith(
        '411',
        245.6,
        1800,
        { baseUrl: 'http://stash.local', apiKey: 'secret' },
      );
    });
  });
});
