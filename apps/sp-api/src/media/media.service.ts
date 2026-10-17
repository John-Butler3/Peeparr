import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  StashAdapter,
  type StashProtectedAssetResponse,
} from '../providers/stash/stash.adapter';
import { fetchWithTimeout } from '../providers/fetch-with-timeout';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Lower qualities Stash converts a scene to as it's watched (HLS: the video
 * in 2-second pieces, played natively by Safari, AirPlay included).
 */
export const HLS_QUALITIES = [
  'FULL_HD',
  'STANDARD_HD',
  'STANDARD',
  'LOW',
] as const;
export type HlsQuality = (typeof HLS_QUALITIES)[number];

export function isHlsQuality(value: string): value is HlsQuality {
  return (HLS_QUALITIES as readonly string[]).includes(value);
}

/** A piece's name in Stash's playlist: "12.ts". */
const HLS_SEGMENT = /^\d{1,6}\.ts$/;

export interface StashSceneStreamResponse {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
}

@Injectable()
export class MediaService {
  /** How long a scene's resolved Stash video URL is reused. */
  private static readonly VIDEO_URL_TTL_MS = 10 * 60 * 1000;

  private readonly logger = new Logger(MediaService.name);
  // A player makes many range requests per video (and previews more still);
  // resolving the Stash URL once per scene instead of per request.
  private readonly videoUrlCache = new Map<
    string,
    { url: string; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly stashAdapter: StashAdapter,
  ) {}

  async getStashSceneScreenshot(
    sceneId: string,
  ): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openSceneScreenshot(sceneId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashStudioLogo(
    studioId: string,
  ): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openStudioLogo(studioId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashPerformerPhoto(
    performerId: string,
  ): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openPerformerPhoto(
      performerId,
      config,
    );
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashGalleryCover(
    galleryId: string,
  ): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openGalleryCover(galleryId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashGroupCover(
    groupId: string,
  ): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openGroupCover(groupId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashImageThumbnail(
    imageId: string,
  ): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openImageThumbnail(imageId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashImageFull(
    imageId: string,
  ): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openImageFull(imageId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  /**
   * Proxies a scene's video from Stash: the full file ('stream') or Stash's
   * generated preview clip ('preview', 404 when not generated).
   */
  async streamStashScene(
    sceneId: string,
    rangeHeader?: string,
    headOnly = false,
    kind: 'stream' | 'preview' = 'stream',
  ): Promise<StashSceneStreamResponse> {
    const cacheKey = `${kind}:${sceneId}`;
    const streamUrl = await this.resolveVideoUrl(sceneId, kind, cacheKey);
    if (!streamUrl) {
      throw new NotFoundException('Stash media asset not found.');
    }

    const requestHeaders: Record<string, string> = {};
    if (rangeHeader) {
      requestHeaders.Range = rangeHeader;
    }

    let response: Response;
    try {
      // Always GET, never HEAD, to Stash -- confirmed AirPlaying the same
      // scene works when played directly from Stash's own player (a real
      // GET), but Stash's HEAD support on this endpoint is unverified, and
      // a HEAD probe that Stash mishandles (error/missing headers) would
      // fail the whole request rather than just being slow. For an
      // incoming HEAD, the body below is cancelled immediately instead of
      // piped, so we still avoid transferring the full video for a probe.
      response = await fetchWithTimeout(streamUrl, {
        method: 'GET',
        headers: requestHeaders,
      });
    } catch (error) {
      this.logger.error(
        `Failed to reach Stash for scene ${sceneId} stream: ${this.redactUrl(streamUrl)} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadGatewayException('Failed to reach Stash provider endpoint.');
    }

    if (!response.ok && response.status !== 206) {
      let bodySnippet = '<unreadable body>';
      try {
        bodySnippet = (await response.text()).slice(0, 500);
      } catch {
        // best-effort diagnostics only
      }
      this.logger.error(
        `Stash returned ${response.status} for scene ${sceneId} stream: ${this.redactUrl(
          streamUrl,
        )} — ${bodySnippet}`,
      );

      // The URL may be stale (scene moved, API key changed): look it up afresh next time.
      this.videoUrlCache.delete(cacheKey);
      if (response.status === 404) {
        throw new NotFoundException('Stash media asset not found.');
      }

      throw new BadGatewayException(
        `Stash provider returned ${response.status} for stream request.`,
      );
    }

    const headers: Record<string, string> = {
      'Accept-Ranges': response.headers.get('accept-ranges') ?? 'bytes',
      // AirPlay/Cast receivers can be strict about needing an explicit,
      // recognized content type before they'll commit to playback; Stash
      // should always send one for a real video file, but fall back rather
      // than silently omitting the header if it ever doesn't.
      'Content-Type': response.headers.get('content-type') ?? 'video/mp4',
    };
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }
    if (contentRange) {
      headers['Content-Range'] = contentRange;
    }

    if (headOnly) {
      // Release the upstream connection rather than let it sit there
      // downloading a body nobody will read.
      response.body?.cancel().catch(() => undefined);
      return { status: response.status, headers, body: null };
    }

    return {
      status: response.status,
      headers,
      body: response.body,
    };
  }

  private async resolveVideoUrl(
    sceneId: string,
    kind: 'stream' | 'preview',
    cacheKey: string,
  ): Promise<string | null> {
    const cached = this.videoUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    const config = await this.getStashConfig();
    const url =
      kind === 'preview'
        ? await this.stashAdapter.getScenePreviewUrl(sceneId, config)
        : await this.stashAdapter.getSceneStreamUrl(sceneId, config);
    if (url) {
      if (this.videoUrlCache.size > 2000) {
        this.videoUrlCache.clear();
      }
      this.videoUrlCache.set(cacheKey, {
        url,
        expiresAt: Date.now() + MediaService.VIDEO_URL_TTL_MS,
      });
    }

    return url;
  }

  async getScenePlaybackInfo(
    sceneId: string,
  ): Promise<{
    resumeSeconds: number;
    duration: number | null;
    height: number | null;
  }> {
    const config = await this.getStashConfig();
    const info = await this.stashAdapter.getScenePlaybackInfo(sceneId, config);
    if (!info) {
      throw new NotFoundException('Stash scene not found.');
    }

    return info;
  }

  async saveScenePlaybackProgress(
    sceneId: string,
    resumeSeconds: number,
    playDuration: number | null,
  ): Promise<void> {
    const config = await this.getStashConfig();
    await this.stashAdapter.saveSceneProgress(
      sceneId,
      resumeSeconds,
      playDuration,
      config,
    );
  }

  /**
   * The scene's HLS playlist at `quality`, from Stash, its pieces' links
   * pointing back here (relative to the playlist: `<quality>/<n>.ts`),
   * carrying `streamToken` for AirPlay receivers.
   */
  async getSceneHlsPlaylist(
    sceneId: string,
    quality: HlsQuality,
    streamToken: string | null,
  ): Promise<string> {
    const cacheKey = `stream:${sceneId}`;
    const streamUrl = await this.resolveVideoUrl(sceneId, 'stream', cacheKey);
    if (!streamUrl) {
      throw new NotFoundException('Stash media asset not found.');
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(hlsUrl(streamUrl, quality));
    } catch {
      throw new BadGatewayException('Failed to reach Stash provider endpoint.');
    }
    if (!response.ok) {
      response.body?.cancel().catch(() => undefined);
      this.videoUrlCache.delete(cacheKey);
      this.logger.error(
        `Stash returned ${response.status} for scene ${sceneId}'s ${quality} playlist.`,
      );
      throw response.status === 404
        ? new NotFoundException('Stash media asset not found.')
        : new BadGatewayException(
            `Stash provider returned ${response.status}.`,
          );
    }

    const suffix = streamToken ? `?st=${encodeURIComponent(streamToken)}` : '';
    return (await response.text())
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          return line;
        }
        // e.g. /scene/12/stream.m3u8/0.ts?resolution=STANDARD_HD&apikey=...
        const piece = /\/stream\.m3u8\/([^/?#]+)/.exec(trimmed)?.[1];
        return piece && HLS_SEGMENT.test(piece)
          ? `${quality}/${piece}${suffix}`
          : '';
      })
      .join('\n');
  }

  /** One piece of the scene's HLS stream at `quality`, from Stash. */
  async streamSceneHlsSegment(
    sceneId: string,
    quality: HlsQuality,
    segment: string,
    headOnly = false,
  ): Promise<StashSceneStreamResponse> {
    if (!HLS_SEGMENT.test(segment)) {
      throw new NotFoundException('Stash media asset not found.');
    }
    const streamUrl = await this.resolveVideoUrl(
      sceneId,
      'stream',
      `stream:${sceneId}`,
    );
    if (!streamUrl) {
      throw new NotFoundException('Stash media asset not found.');
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(hlsUrl(streamUrl, quality, segment));
    } catch {
      throw new BadGatewayException('Failed to reach Stash provider endpoint.');
    }
    if (!response.ok) {
      response.body?.cancel().catch(() => undefined);
      this.logger.error(
        `Stash returned ${response.status} for scene ${sceneId}'s ${quality} piece ${segment}.`,
      );
      throw new BadGatewayException(
        `Stash provider returned ${response.status}.`,
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': response.headers.get('content-type') ?? 'video/mp2t',
      // Converted as it's asked for: the same piece again is the same.
      'Cache-Control': 'private, max-age=3600',
    };
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }
    if (headOnly) {
      response.body?.cancel().catch(() => undefined);
      return { status: 200, headers, body: null };
    }
    return { status: 200, headers, body: response.body };
  }

  private redactUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('apikey')) {
        parsed.searchParams.set('apikey', '<redacted>');
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private async getStashConfig(): Promise<{
    baseUrl: string;
    apiKey?: string | null;
  }> {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { type: 'STASH' },
    });
    const baseUrl = integration?.baseUrl?.trim();

    if (
      !integration ||
      !integration.enabled ||
      integration.status !== 'CONFIGURED' ||
      !baseUrl
    ) {
      throw new ServiceUnavailableException('Stash media is unavailable.');
    }

    return {
      baseUrl,
      apiKey: integration.apiKey,
    };
  }
}

/**
 * Stash's HLS address for a scene, from its stream address (which carries
 * its API key): /scene/<id>/stream -> /scene/<id>/stream.m3u8[/<piece>].
 */
function hlsUrl(
  streamUrl: string,
  quality: HlsQuality,
  segment?: string,
): string {
  const url = new URL(streamUrl);
  url.pathname = `${url.pathname.replace(/\/stream$/, '')}/stream.m3u8${segment ? `/${segment}` : ''}`;
  url.searchParams.set('resolution', quality);
  return url.toString();
}
