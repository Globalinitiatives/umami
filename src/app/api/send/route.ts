import { startOfHour } from 'date-fns';
import { isbot } from 'isbot';
import { z } from 'zod';
import clickhouse from '@/lib/clickhouse';
import { CACHE_TOKEN_TYPE, COLLECTION_TYPE, EVENT_TYPE, FIELD_LENGTH } from '@/lib/constants';
import { getSalt, hash, secret, uuid } from '@/lib/crypto';
import { getClientInfo, hasBlockedIp } from '@/lib/detect';
import { truncateString } from '@/lib/format';
import { createToken, parseToken } from '@/lib/jwt';
import { fetchWebsite } from '@/lib/load';
import { parseRequest } from '@/lib/request';
import { badRequest, forbidden, json, serverError } from '@/lib/response';
import { anyObjectParam, urlOrPathParam } from '@/lib/schema';
import { safeDecodeURI, safeDecodeURIComponent } from '@/lib/url';
import { createSession, saveEvent, saveSessionData, saveSessionLink, updateSession } from '@/queries/sql';

interface Cache {
  websiteId: string;
  sessionId: string;
  visitId: string;
  iat: number;
  sessionLinkId?: string;
}

// Reject strings whose first character is a spreadsheet formula trigger to
// prevent CSV formula injection in analytics exports (defense-in-depth).
const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;
const safeStringParam = () =>
  z.string().refine(val => !FORMULA_TRIGGER_RE.test(val), {
    message: 'Value must not start with =, +, -, @, tab, or carriage return',
  });

const schema = z.object({
  type: z.enum(['event', 'identify', 'performance']),
  payload: z
    .object({
      website: z.uuid().optional(),
      link: z.uuid().optional(),
      pixel: z.uuid().optional(),
      data: anyObjectParam.optional(),
      hostname: z.string().optional(),
      language: z.string().optional(),
      referrer: urlOrPathParam.optional(),
      screen: z.string().optional(),
      title: z.string().optional(),
      url: urlOrPathParam.optional(),
      name: safeStringParam().optional(),
      tag: safeStringParam().optional(),
      ip: z.string().optional(),
      userAgent: z.string().optional(),
      timestamp: z.coerce.number().int().optional(),
      id: z.string().optional(),
      browser: z.string().optional(),
      os: z.string().optional(),
      device: z.string().optional(),
      lcp: z.number().nonnegative().max(60000).optional(),
      inp: z.number().nonnegative().max(60000).optional(),
      cls: z.number().nonnegative().max(100).optional(),
      fcp: z.number().nonnegative().max(60000).optional(),
      ttfb: z.number().nonnegative().max(60000).optional(),
    })
    .refine(
      data => {
        const keys = [data.website, data.link, data.pixel];
        const count = keys.filter(Boolean).length;
        return count === 1;
      },
      {
        message: 'Exactly one of website, link, or pixel must be provided',
        path: ['website'],
      },
    ),
});

export async function POST(request: Request) {
  try {
    const { body, error } = await parseRequest(request, schema, { skipAuth: true });

    if (error) {
      return error();
    }

    const { type, payload } = body;

    const {
      website: websiteId,
      pixel: pixelId,
      link: linkId,
      hostname,
      screen,
      language,
      url,
      referrer,
      name,
      data,
      title,
      tag,
      timestamp,
      id,
      lcp,
      inp,
      cls,
      fcp,
      ttfb,
    } = payload;

    const sourceId = websiteId || pixelId || linkId;

    // Cache check
    let cache: Cache | null = null;

    if (websiteId) {
      const cacheHeader = request.headers.get('x-gmanalytics-cache');

      if (cacheHeader) {
        const result = await parseToken(cacheHeader, secret());

        if (result?.type === CACHE_TOKEN_TYPE) {
          cache = result;
        }
      }

      // Find website
      if (!cache?.websiteId) {
        const website = await fetchWebsite(websiteId);

        if (!website) {
          return badRequest({ message: 'Website not found.' });
        }
      }
    }

    // Carried forward in the cache token so repeat identify calls skip identity writes
    let sessionLinkId = cache?.sessionLinkId;

    // Client info
    const { ip, userAgent, device, browser, os, country, region, city } = await getClientInfo(
      request,
      payload,
    );

    // Bot check
    if (!process.env.DISABLE_BOT_CHECK && isbot(userAgent)) {
      return json({ beep: 'boop' });
    }

    // IP block
    if (hasBlockedIp(ip)) {
      return forbidden();
    }

    const createdAt = timestamp ? new Date(timestamp * 1000) : new Date();
    const now = Math.floor(Date.now() / 1000);
    const distinctId = truncateString(id, FIELD_LENGTH.distinctId);

    const saltRotation = process.env.SALT_ROTATION || 'month';
    const sessionSalt = getSalt(saltRotation, createdAt);
    const visitSalt = hash(startOfHour(createdAt).toUTCString());

    // Identified users need a separate deterministic session from anonymous users
    // who happen to share the same IP address and user agent.
    const sessionId = uuid(sourceId, ip, userAgent, sessionSalt, distinctId ?? '');
    const sessionDrift = !!websiteId && !!cache?.sessionId && cache.sessionId !== sessionId;
    const shouldEnsureSession = !clickhouse.enabled && sessionDrift;

    // Create a session if not found
    if ((!clickhouse.enabled && !cache?.sessionId) || shouldEnsureSession) {
      await createSession({
        id: sessionId,
        websiteId: sourceId,
        browser,
        os,
        device,
        screen,
        language,
        country,
        region,
        city,
        distinctId,
        createdAt,
      });
    }

    // Visit info
    let visitId = cache?.visitId || uuid(sessionId, visitSalt);
    let iat = cache?.iat || now;

    // A drifted cache session should start a fresh visit on the recomputed session.
    if (sessionDrift) {
      visitId = uuid(sessionId, visitSalt);
      iat = now;
    }

    // Expire visit after 30 minutes
    if (!timestamp && now - iat > 1800) {
      visitId = uuid(sessionId, visitSalt);
      iat = now;
    }

    if (type === COLLECTION_TYPE.event) {
      const base = hostname ? `https://${hostname}` : 'https://localhost';
      const currentUrl = new URL(url, base);

      let urlPath =
        currentUrl.pathname === '/undefined' ? '' : currentUrl.pathname + currentUrl.hash;
      const urlQuery = currentUrl.search.substring(1);
      const urlDomain = currentUrl.hostname.replace(/^www\./, '');

      let referrerPath: string;
      let referrerQuery: string;
      let referrerDomain: string;

      // UTM Params — case-insensitive extraction from URL (handles utm_source,
      // UTM_SOURCE, utm_Source, etc.), with fallback to data.utms for custom
      // track() events that carry UTMs in the payload after navigation away from
      // the UTM-tagged landing page. The native UTM report reads these columns
      // from website_event, so both pageviews and custom events need them.
      function getUtmParam(params: URLSearchParams, key: string): string | undefined {
        // Try multiple case variants of the key
        const candidates = [
          key,
          key.toLowerCase(),
          key.charAt(0).toUpperCase() + key.slice(1).toLowerCase(),
          key.toUpperCase(),
        ];
        for (const k of candidates) {
          const v = params.get(k);
          if (v) return v;
        }
        // Fallback: scan all params for a case-insensitive match
        const lower = key.toLowerCase();
        for (const [p, v] of params.entries()) {
          if (p.toLowerCase() === lower) return v;
        }
        return undefined;
      }

      const urlUtms = {
        source: getUtmParam(currentUrl.searchParams, 'utm_source'),
        medium: getUtmParam(currentUrl.searchParams, 'utm_medium'),
        campaign: getUtmParam(currentUrl.searchParams, 'utm_campaign'),
        content: getUtmParam(currentUrl.searchParams, 'utm_content'),
        term: getUtmParam(currentUrl.searchParams, 'utm_term'),
      };

      const dataUtms = (typeof data === 'object' && data !== null && 'utms' in data)
        ? (data as { utms?: Record<string, string> }).utms : undefined;

      const utmSource = urlUtms.source || (dataUtms && dataUtms.source);
      const utmMedium = urlUtms.medium || (dataUtms && dataUtms.medium);
      const utmCampaign = urlUtms.campaign || (dataUtms && dataUtms.campaign);
      const utmContent = urlUtms.content || (dataUtms && dataUtms.content);
      const utmTerm = urlUtms.term || (dataUtms && dataUtms.term);

      // Strip utms from event data before persisting to avoid duplicate
      // utms.source / utms.medium / utms.campaign columns in the admin UI.
      // The native utm_source / utm_medium / utm_campaign columns already
      // capture these values via the urlUtms / dataUtms fallback above.
      let eventData = data;
      if (typeof eventData === 'object' && eventData !== null && 'utms' in eventData) {
        const { utms, ...rest } = eventData as Record<string, unknown>;
        // When UTM data is present, promote UTM values to source/medium/campaign
        // in the event properties. This ensures the events UI shows the campaign
        // attribution (e.g. "mytest") rather than the page path (data.source).
        // The native utm_source column already captures this — this keeps the
        // event property and the UTM column consistent.
        const utmRecord = typeof utms === 'object' && utms !== null ? utms as Record<string, unknown> : {};
        eventData = {
          ...rest,
          source: utmRecord.source ?? rest.source,
          medium: utmRecord.medium ?? rest.source,
          campaign: utmRecord.campaign ?? rest.source,
        } as Record<string, unknown>;
      }

      // Click IDs
      const gclid = currentUrl.searchParams.get('gclid');
      const fbclid = currentUrl.searchParams.get('fbclid');
      const msclkid = currentUrl.searchParams.get('msclkid');
      const ttclid = currentUrl.searchParams.get('ttclid');
      const lifatid = currentUrl.searchParams.get('li_fat_id');
      const twclid = currentUrl.searchParams.get('twclid');

      if (process.env.REMOVE_TRAILING_SLASH) {
        // Never strip the root slash, otherwise the home page is saved with an empty path
        urlPath = urlPath.replace(/(?!^)\/(?=(#.*)?$)/, '');
      }

      if (referrer) {
        // Canonicalize the event domain (lowercase, punycode, no port) so it
        // compares correctly against the parsed referrer hostname
        let eventDomain = urlDomain;
        if (hostname) {
          try {
            eventDomain = new URL(`https://${hostname}`).hostname.replace(/^www\./, '');
          } catch {
            eventDomain = hostname.replace(/^www\./, '');
          }
        }
        // Resolve path-only referrers against the event's domain, not the localhost fallback
        const referrerUrl = new URL(referrer, eventDomain ? `https://${eventDomain}` : base);

        referrerPath = referrerUrl.pathname;
        referrerQuery = referrerUrl.search.substring(1);
        referrerDomain = referrerUrl.hostname.replace(/^www\./, '');

        // Never save the referrer domain for self-referrals
        if (referrerDomain === eventDomain) {
          referrerDomain = undefined;
        }
      }

      const eventType = linkId
        ? EVENT_TYPE.linkEvent
        : pixelId
          ? EVENT_TYPE.pixelEvent
          : name
            ? EVENT_TYPE.customEvent
            : EVENT_TYPE.pageView;

      await saveEvent({
        websiteId: sourceId,
        sessionId,
        visitId,
        eventType,
        createdAt,

        // Page
        pageTitle: safeDecodeURIComponent(title),
        hostname: hostname || urlDomain,
        urlPath: safeDecodeURI(urlPath),
        urlQuery,
        referrerPath: safeDecodeURI(referrerPath),
        referrerQuery,
        referrerDomain,

        // Session
        distinctId,
        browser,
        os,
        device,
        screen,
        language,
        country,
        region,
        city,

        // Events
        eventName: name,
        eventData,
        tag,

        // UTM
        utmSource: urlUtms.source || (dataUtms && dataUtms.source),
        utmMedium: urlUtms.medium || (dataUtms && dataUtms.medium),
        utmCampaign: urlUtms.campaign || (dataUtms && dataUtms.campaign),
        utmContent: urlUtms.content || (dataUtms && dataUtms.content),
        utmTerm: urlUtms.term || (dataUtms && dataUtms.term),

        // Click IDs
        gclid,
        fbclid,
        msclkid,
        ttclid,
        lifatid,
        twclid,
      });
    } else if (type === COLLECTION_TYPE.identify) {
      if (websiteId && distinctId) {
        const newLinkId = hash(sessionId, distinctId);

        if (sessionLinkId !== newLinkId) {
          // Best-effort: identity link failures must not block the session data write below.
          try {
            await Promise.all([
              saveSessionLink({
                websiteId,
                sessionId,
                distinctId,
                createdAt,
              }),
              updateSession({
                websiteId,
                sessionId,
                distinctId,
              }),
            ]);
            sessionLinkId = newLinkId;
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('Failed to save session link:', e);
          }
        }
      }

      if (data) {
        await saveSessionData({
          websiteId,
          sessionId,
          sessionData: data,
          distinctId,
          createdAt,
        });
      }
    } else if (type === COLLECTION_TYPE.performance) {
      const base = hostname ? `https://${hostname}` : 'https://localhost';
      const currentUrl = new URL(url, base);
      const urlPath = currentUrl.pathname === '/undefined' ? '' : currentUrl.pathname;

      await saveEvent({
        websiteId: sourceId,
        sessionId,
        visitId,
        urlPath,
        pageTitle: safeDecodeURIComponent(title),
        eventType: EVENT_TYPE.performance,
        browser,
        os,
        device,
        screen,
        language,
        country,
        region,
        city,
        lcp,
        inp,
        cls,
        fcp,
        ttfb,
        createdAt,
      });
    }

    const token = createToken(
      { websiteId, sessionId, visitId, iat, sessionLinkId, type: CACHE_TOKEN_TYPE },
      secret(),
    );

    return json({ cache: token, sessionId, visitId });
  } catch (e) {
    return serverError(e);
  }
}
