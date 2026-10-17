/**
 * Pornhub's embed player for a scene, from its catalog link: TPDB lists
 * Pornhub creators' scenes (sites like "Pornhub: <name>") with their page,
 * pornhub.com/view_video.php?viewkey=<key>. The embed player is Pornhub's
 * own way of showing its videos on other sites (a page made to be framed);
 * the video itself is never fetched or proxied by Peeparr.
 */
const VIEWKEY = /^[A-Za-z0-9]{6,32}$/;

export const PORNHUB_EMBED_ORIGIN = 'https://www.pornhub.com';

/** The embed URL for the first Pornhub video page among `urls`, or null. */
export function pornhubEmbedUrl(
  urls: ReadonlyArray<{ url: string }>,
): string | null {
  for (const { url } of urls) {
    const viewkey = pornhubViewkey(url);
    if (viewkey) {
      return `${PORNHUB_EMBED_ORIGIN}/embed/${viewkey}`;
    }
  }
  return null;
}

function pornhubViewkey(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // pornhub.com or a subdomain of it (www., country ones like nz.).
  const host = url.hostname.toLowerCase();
  if (host !== 'pornhub.com' && !host.endsWith('.pornhub.com')) {
    return null;
  }
  const fromQuery = url.searchParams.get('viewkey');
  const fromEmbed = /^\/embed\/([^/]+)/.exec(url.pathname)?.[1];
  const viewkey = fromQuery ?? fromEmbed ?? null;
  return viewkey && VIEWKEY.test(viewkey) ? viewkey : null;
}

/**
 * Whether a catalog scene plays streamed from Pornhub: streaming is on, it
 * isn't in the library, and its page (TPDB lists give it) is a Pornhub video.
 */
export function streamsFromPornhub(
  url: string | null | undefined,
  status: { state: string },
  streamingOn: boolean,
): boolean {
  return (
    streamingOn === true &&
    status.state !== 'AVAILABLE' &&
    !!url &&
    pornhubEmbedUrl([{ url }]) !== null
  );
}
