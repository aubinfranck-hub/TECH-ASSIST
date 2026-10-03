import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChatUi, FALLBACK_SLIDES, parseSlides } from '../chatServer.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function siteFetch(routes: Record<string, { type: string; body: Buffer | string; status?: number }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const path = url.replace('https://site.test', '');
    const r = routes[path];
    if (!r) return new Response('nope', { status: 404 });
    return new Response(r.body, { status: r.status ?? 200, headers: { 'content-type': r.type } });
  }) as typeof fetch;
}

describe('diapositives pendant le travail', () => {
  it('ne garde que des diapositives sûres (texte court, images du site)', () => {
    const slides = parseSlides({
      slides: [
        { title: 'Bonjour', text: 'ok', image: '/img/hero.jpg', items: [{ image: '/img/pc.jpg', label: 'PC' }, { image: 'https://evil.test/x.jpg', label: 'X' }] },
        { title: '', text: 'sans titre' },
        { title: 'Image externe', text: 'x', image: 'https://evil.test/a.jpg' },
        { title: 'Chemin piégé', text: 'x', image: '/img/../../etc/passwd' },
        'pas un objet',
      ],
    });
    expect(slides).toHaveLength(3);
    expect(slides[0]).toEqual({ title: 'Bonjour', text: 'ok', image: '/img/hero.jpg', items: [{ image: '/img/pc.jpg', label: 'PC' }] });
    expect(slides[1]!.image).toBeUndefined();
    expect(slides[2]!.image).toBeUndefined();
  });

  it('le fichier slides.json du site est valide et ses images existent', () => {
    const raw = JSON.parse(readFileSync(new URL('../../../web/public/slides.json', import.meta.url), 'utf8')) as { slides: unknown[] };
    const slides = parseSlides(raw);
    expect(slides).toHaveLength(raw.slides.length); // rien n'est rejeté
    for (const s of slides) for (const path of [s.image, ...(s.items ?? []).map((i) => i.image)]) {
      if (path) expect(() => readFileSync(new URL(`../../../web/public${path}`, import.meta.url))).not.toThrow();
    }
  });

  it('relaie les diapositives et les images du site, avec secours si le site est injoignable', async () => {
    const ui = await ChatUi.start({
      site: 'https://site.test',
      fetchImpl: siteFetch({
        '/slides.json': { type: 'application/json', body: JSON.stringify({ slides: [{ title: 'Salut', text: 'bienvenue', image: '/img/hero.jpg' }] }) },
        '/img/hero.jpg': { type: 'image/jpeg', body: jpeg },
      }),
    });
    try {
      const slides = (await (await fetch(`${ui.url.replace('/?', '/slides?')}`)).json()) as { slides: unknown[] };
      expect(slides.slides).toEqual([{ title: 'Salut', text: 'bienvenue', image: '/img/hero.jpg' }]);
      const img = await fetch(`${ui.url.replace('/?', '/slide-image?')}&p=${encodeURIComponent('/img/hero.jpg')}`);
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/jpeg');
      const bad = await fetch(`${ui.url.replace('/?', '/slide-image?')}&p=${encodeURIComponent('https://evil.test/x.jpg')}`);
      expect(bad.status).toBe(404);
    } finally {
      await ui.close();
    }

    const down = await ChatUi.start({ site: 'https://site.test', fetchImpl: siteFetch({}) });
    try {
      const slides = (await (await fetch(down.url.replace('/?', '/slides?'))).json()) as { slides: unknown[] };
      expect(slides.slides).toEqual(FALLBACK_SLIDES);
    } finally {
      await down.close();
    }
  });
});
