import { cached, politeFetch } from './net.ts';
import type { LicenseInfo } from './license.ts';

type OpenverseResult = {
  title?: string;
  url?: string;
  thumbnail?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  foreign_landing_url?: string;
};

export async function openverseSearch(opts: {
  query: string;
  license?: string;
  limit?: number;
}): Promise<{ title?: string; url?: string; thumbnail?: string; license: LicenseInfo }[]> {
  const { query, license = 'cc0,by', limit = 6 } = opts;
  const url =
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
    `&license=${encodeURIComponent(license)}&page_size=${limit}`;
  const data = (await cached(url, async () => (await politeFetch(url)).json())) as {
    results?: OpenverseResult[];
  };
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    thumbnail: r.thumbnail,
    license: {
      type: r.license?.toLowerCase() === 'cc0' ? 'CC0' : 'CC-BY',
      attribution: `"${r.title}" by ${r.creator ?? 'unknown'}, ${String(r.license).toUpperCase()} ${r.license_version ?? ''}`.trim(),
      sourceUrl: r.foreign_landing_url,
    },
  }));
}

export async function voaList(opts: {
  feedUrl: string;
  limit?: number;
}): Promise<
  { title?: string; link?: string; published?: string; audioUrl?: string; license: LicenseInfo }[]
> {
  const { feedUrl, limit = 10 } = opts;
  const xml = String(await cached(feedUrl, async () => (await politeFetch(feedUrl)).text()));
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map((m) => {
    const block = m[1] ?? '';
    const pick = (tag: string) =>
      block
        .match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))?.[1]
        ?.trim();
    return {
      title: pick('title'),
      link: pick('link'),
      published: pick('pubDate'),
      audioUrl: block.match(/<enclosure[^>]+url="([^"]+)"/)?.[1],
      license: {
        type: 'public-domain',
        attribution: 'VOA Learning English (learningenglish.voanews.com)',
        sourceUrl: pick('link'),
      },
    };
  });
}

type LibriVoxBook = {
  id?: string;
  title?: string;
  authors?: { first_name?: string; last_name?: string }[];
  url_librivox?: string;
  url_zip_file?: string;
};

export async function librivoxSearch(opts: {
  title?: string;
  limit?: number;
}): Promise<{ id?: string; title?: string; author: string; url?: string; zip?: string; license: LicenseInfo }[]> {
  const { title, limit = 5 } = opts;
  const params = new URLSearchParams({ format: 'json', limit: String(limit) });
  if (title) params.set('title', title);
  const url = `https://librivox.org/api/feed/audiobooks/?${params}`;
  const data = (await cached(url, async () => (await politeFetch(url)).json())) as {
    books?: LibriVoxBook[];
  };
  return (data.books ?? []).map((b) => {
    const a = b.authors?.[0];
    return {
      id: b.id,
      title: b.title,
      author: a ? `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() : '',
      url: b.url_librivox,
      zip: b.url_zip_file,
      license: {
        type: 'public-domain',
        attribution: `LibriVox — ${b.title ?? 'recording'} (public domain)`,
        sourceUrl: b.url_librivox,
      },
    };
  });
}
