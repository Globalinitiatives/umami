import { afterEach, expect, test, vi } from 'vitest';
import type { GmanalyticsTracker } from './index';

afterEach(() => {
  delete (window as Window & { umami?: unknown }).umami;
  delete (window as Window & { gmanalytics?: unknown }).gmanalytics;
  delete (document as Document & { currentScript?: HTMLScriptElement }).currentScript;
  delete (document as Document & { readyState?: DocumentReadyState }).readyState;
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('identifies data-distinct-id before the initial page view', async () => {
  const script = document.createElement('script');
  script.src = 'https://analytics.example.com/gmanalytics.js';
  script.dataset.websiteId = 'website-id';
  script.dataset.distinctId = 'visitor-id';

  Object.defineProperties(document, {
    currentScript: { configurable: true, value: script },
    readyState: { configurable: true, value: 'complete' },
  });

  const fetchMock = vi.fn().mockResolvedValue({ json: vi.fn().mockResolvedValue({}) });
  vi.stubGlobal('fetch', fetchMock);

  await import('./index');

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));

  expect(requests[0]).toMatchObject({
    type: 'identify',
    payload: { id: 'visitor-id', website: 'website-id' },
  });
  expect(requests[1]).toMatchObject({
    type: 'event',
    payload: { id: 'visitor-id', website: 'website-id' },
  });
});

/**
 * UTM capture (issue #22).
 *
 * By default the harness disables auto-tracking so a test can drive `track()`
 * itself and assert on an exact request list, rather than racing the auto
 * pageview. A test that needs `init()` (performance, path-change hooks) opts
 * back in via `extra`.
 */
const setup = async (search: string, extra: Record<string, string> = {}) => {
  const script = document.createElement('script');
  script.src = 'https://analytics.example.com/gmanalytics.js';
  script.dataset.websiteId = 'website-id';
  // `autoTrack` also gates `init()`, which is what installs the pushState hook
  // and starts performance monitoring. Turning it off disables the very path
  // these tests drive, so each test turns off just the pageview it doesn't want.
  for (const [k, v] of Object.entries({ autoTrack: 'false', ...extra })) script.dataset[k] = v;

  Object.defineProperties(document, {
    currentScript: { configurable: true, value: script },
    readyState: { configurable: true, value: 'complete' },
  });

  const fetchMock = vi.fn().mockResolvedValue({ json: vi.fn().mockResolvedValue({}) });
  vi.stubGlobal('fetch', fetchMock);

  // A LIVE location object, not a frozen snapshot. The SPA tests need the query
  // string to actually change between events — a static stub would make them
  // pass even with the "first value wins" guard removed, because nothing would
  // ever present a second campaign to overwrite the first.
  let currentSearch = search;
  const realLocation = {
    get href() {
      return `https://site.example/page${currentSearch}`;
    },
    get search() {
      return currentSearch;
    },
    hostname: 'site.example',
    origin: 'https://site.example',
  };
  vi.stubGlobal('location', realLocation);

  await import('./index');

  const tracker = (window as Window & { gmanalytics?: GmanalyticsTracker }).gmanalytics!;
  const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));

  // Mirrors what an SPA does: change the query string, then notify listeners.
  // `push` drives the pushState hook, which is where the tracker flushes
  // performance data; a real back/forward gesture only fires popstate.
  const navigate = (next: string, push = false) => {
    currentSearch = next;
    if (push) {
      history.pushState({}, '', `/page${next}`);
      return;
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return { tracker, fetchMock, bodies, navigate };
};

test('captures UTM params from the landing URL and attaches them to a custom event', async () => {
  const { tracker, bodies } = await setup('?utm_source=news&utm_medium=email&utm_campaign=spring');

  await tracker.track('signup', { plan: 'pro' });

  expect(bodies()).toHaveLength(1);
  expect(bodies()[0].payload.data).toEqual({
    utms: { source: 'news', medium: 'email', campaign: 'spring' },
    plan: 'pro',
  });
});

test('matches UTM keys case-insensitively, like the server', async () => {
  const { tracker, bodies } = await setup('?UTM_SOURCE=news&Utm_Campaign=spring');

  await tracker.track('signup');

  expect(bodies()[0].payload.data).toEqual({
    utms: { source: 'news', campaign: 'spring' },
  });
});

test('sends no data.utms when the URL carries no UTM params', async () => {
  const { tracker, bodies } = await setup('');

  await tracker.track('signup', { plan: 'pro' });

  // No empty `utms` object: the payload must be identical to before this change.
  expect(bodies()[0].payload.data).toEqual({ plan: 'pro' });
});

test('a caller-supplied utms wins over the captured value', async () => {
  const { tracker, bodies } = await setup('?utm_source=news');

  await tracker.track('signup', { utms: { source: 'explicit' } });

  expect(bodies()[0].payload.data).toEqual({ utms: { source: 'explicit' } });
});

test('data-exclude-search suppresses UTM capture', async () => {
  const { tracker, bodies } = await setup('?utm_source=news', { excludeSearch: 'true' });

  await tracker.track('signup', { plan: 'pro' });

  expect(bodies()[0].payload.data).toEqual({ plan: 'pro' });
});

test('UTMs survive SPA navigation, where the query string is gone', async () => {
  const { tracker, bodies, navigate } = await setup('?utm_source=news&utm_campaign=spring');

  await tracker.track('signup');

  // The campaign is stripped from the URL by client-side routing — the case
  // the capture exists for.
  navigate('');
  await tracker.track('purchase', { total: 42 });

  expect(bodies()).toHaveLength(2);
  expect(bodies()[1].payload.data).toEqual({
    utms: { source: 'news', campaign: 'spring' },
    total: 42,
  });
});

test('the first campaign in a page lifetime is not overwritten by a later one', async () => {
  const { tracker, bodies, navigate } = await setup('?utm_source=first');

  await tracker.track('a');
  navigate('?utm_source=second');
  await tracker.track('b');

  expect(bodies()[1].payload.data.utms).toEqual({ source: 'first' });
});

test('nothing is written to storage', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem');

  const { tracker } = await setup('?utm_source=news');
  await tracker.track('signup');

  expect(setItem).not.toHaveBeenCalled();
});

test('identify() keeps the carried UTMs alongside its own data', async () => {
  const { tracker, bodies } = await setup('?utm_source=news&utm_campaign=spring');

  await tracker.identify('user-1', { plan: 'pro' });

  expect(bodies()[0].payload.data).toEqual({
    utms: { source: 'news', campaign: 'spring' },
    plan: 'pro',
  });
});

test('identify() keeps the carried UTMs when called with a bare id', async () => {
  const { tracker, bodies } = await setup('?utm_source=news');

  await tracker.identify('user-1');

  expect(bodies()[0].payload.data).toEqual({ utms: { source: 'news' } });
});

test('identify() keeps the carried UTMs when the id is passed as an object', async () => {
  const { tracker, bodies } = await setup('?utm_source=news');

  await tracker.identify({ id: 'user-1', plan: 'pro' });

  expect(bodies()[0].payload.data).toEqual({
    utms: { source: 'news' },
    id: 'user-1',
    plan: 'pro',
  });
});

test('identify() keeps the carried UTMs after SPA navigation', async () => {
  const { tracker, bodies, navigate } = await setup('?utm_source=news&utm_campaign=spring');

  await tracker.identify('user-1');
  navigate('');
  await tracker.identify('user-1', { plan: 'pro' });

  expect(bodies()[1].payload.data).toEqual({
    utms: { source: 'news', campaign: 'spring' },
    plan: 'pro',
  });
});

test('identify() without UTMs sends only its own data', async () => {
  const { tracker, bodies } = await setup('?page=2');

  await tracker.identify('user-1', { plan: 'pro' });

  expect(bodies()[0].payload.data).toEqual({ plan: 'pro' });
});

test('the performance payload carries no UTM data', async () => {
  // jsdom has no PerformanceObserver, so no metrics are recorded. The flush
  // lives on the pushState hook, so drive that rather than popstate, and seed
  // one metric so `sendPerformance` is not a no-op on an empty set.
  const { tracker, bodies, navigate } = await setup('?utm_source=news&utm_campaign=spring', {
    performance: 'true',
    autoTrack: 'true',
    autoPageview: 'false',
  });

  performance.getEntriesByType = vi.fn().mockReturnValue([
    { name: 'paint', startTime: 10, duration: 5 },
  ]) as unknown as Performance['getEntriesByType'];

  // Establish the capture first. UTMs are held in memory and filled in by the
  // first payload built, so with no prior event there is nothing to carry.
  await tracker.track();

  navigate('/next', true);
  await vi.waitFor(() => {
    expect(bodies().some((b: { type: string }) => b.type === 'performance')).toBe(true);
  });

  const perf = bodies().find((b: { type: string }) => b.type === 'performance');
  expect(perf?.payload.data).toBeUndefined();
});
