import { cached, politeFetch } from './net.ts';
import type { LicenseInfo, LicenseType } from './license.ts';

// African Storybook English source — CC-licensed leveled stories as Markdown.
const REPO = 'global-asp/asp-source';
const BRANCH = 'master';

const LICENSE_MAP: Record<string, LicenseType> = {
  'CC-BY': 'CC-BY',
  'CC BY': 'CC-BY',
  'CC-BY-SA': 'CC-BY-SA',
  'CC BY-SA': 'CC-BY-SA',
  CC0: 'CC0',
  'PUBLIC DOMAIN': 'public-domain',
};

const titleFromPath = (path: string) =>
  (path.split('/').pop() ?? '')
    .replace(/\.md$/, '')
    .replace(/^\d+_/, '')
    .replace(/-/g, ' ');

export async function storybookSearch(opts: {
  query?: string;
  limit?: number;
}): Promise<{ path: string; title: string }[]> {
  const { query, limit = 15 } = opts;
  const url = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
  const tree = (await cached(url, async () => (await politeFetch(url)).json())) as {
    tree?: { path: string; type: string }[];
  };
  const q = query?.toLowerCase();
  return (tree.tree ?? [])
    .filter((n) => n.type === 'blob' && /^en\/.+\.md$/.test(n.path))
    .map((n) => ({ path: n.path, title: titleFromPath(n.path) }))
    .filter((n) => !q || n.title.includes(q))
    .slice(0, limit);
}

export type Storybook = {
  path: string;
  title: string;
  pages: string[];
  author?: string;
  license: LicenseInfo;
  sourceUrl: string;
};

export async function storybookFetch(path: string): Promise<Storybook> {
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;
  const md = String(await cached(rawUrl, async () => (await politeFetch(rawUrl)).text()));

  const lines = md.split(/\r?\n/);
  const title = lines.find((l) => l.startsWith('# '))?.slice(2).trim() ?? titleFromPath(path);

  const footerStart = lines.findIndex((l) => /^\*\s*License:/i.test(l));
  const body = footerStart >= 0 ? lines.slice(0, footerStart) : lines;
  const footer = footerStart >= 0 ? lines.slice(footerStart) : [];

  const pages = body
    .join('\n')
    .split(/^##\s*$/m)
    .map((p) => p.replace(/^#.*$/gm, '').trim())
    .filter(Boolean);

  const pick = (label: string) =>
    footer
      .find((l) => new RegExp(`^\\*\\s*${label}:`, 'i').test(l))
      ?.replace(new RegExp(`^\\*\\s*${label}:\\s*`, 'i'), '')
      .replace(/\[|\]/g, '')
      .trim();

  const licenseRaw = (pick('License') ?? '').toUpperCase();
  const type = LICENSE_MAP[licenseRaw];
  if (!type) {
    throw new Error(`"${title}" has a non-redistributable license (${licenseRaw || 'unknown'}) — skip it`);
  }
  const author = pick('Text');

  return {
    path,
    title,
    pages,
    author,
    license: {
      type,
      attribution: `${author ? author + ', ' : ''}African Storybook (global-asp), ${licenseRaw}`,
      sourceUrl: `https://github.com/${REPO}/blob/${BRANCH}/${path}`,
    },
    sourceUrl: rawUrl,
  };
}
