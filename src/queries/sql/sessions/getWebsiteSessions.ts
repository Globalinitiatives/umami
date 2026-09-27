import clickhouse from '@/lib/clickhouse';
import { EVENT_COLUMNS, EVENT_TYPE, FILTER_COLUMNS } from '@/lib/constants';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';
import type { PageResult, QueryFilters, WebsiteSession } from '@/lib/types';

const FUNCTION_NAME = 'getWebsiteSessions';
const QUALIFIED_FILTER_COLUMNS = Object.fromEntries(
  Object.entries(FILTER_COLUMNS).map(([key, value]) => [key, `website_event.${value}`]),
);

// Whitelist of client-facing sort keys. `orderBy` arrives from the query string
// and is interpolated into raw SQL by pagedRawQuery, so it must never be passed
// through unvalidated. Anything not listed here is ignored and the caller's
// default ordering applies. ClickHouse overrides the expressions because its
// aggregates differ from Postgres.
const SESSION_SORT_KEYS = [
  'visits',
  'views',
  'events',
  'duration',
  'lastAt',
  'location',
  'browser',
  'os',
  'device',
] as const;

export type SessionSortKey = (typeof SESSION_SORT_KEYS)[number];

const POSTGRES_SORT_COLUMNS: Record<SessionSortKey, string> = {
  visits: `count(distinct website_event.visit_id)`,
  views: `sum(case when website_event.event_type = ${EVENT_TYPE.pageView} then 1 else 0 end)`,
  events: `sum(case when website_event.event_type = ${EVENT_TYPE.customEvent} then 1 else 0 end)`,
  duration: `extract(epoch from (max(website_event.created_at) - min(website_event.created_at)))`,
  lastAt: `max(website_event.created_at)`,
  location: `session.country`,
  browser: `session.browser`,
  os: `session.os`,
  device: `session.device`,
};

/**
 * Maps a client-supplied `orderBy` to a safe SQL expression.
 * Returns undefined for unknown keys, which makes pagedRawQuery fall back to
 * its `defaultOrderBy` instead of interpolating the raw value.
 *
 * Uses Object.hasOwn rather than `in` so inherited Object.prototype keys
 * (`__proto__`, `constructor`, `toString`) are rejected too — `in` walks the
 * prototype chain and would let those through as non-SQL values.
 */
export function resolveSessionOrderBy(
  orderBy: string | undefined,
  columns: Record<SessionSortKey, string> = POSTGRES_SORT_COLUMNS,
) {
  return orderBy && Object.hasOwn(columns, orderBy) ? columns[orderBy as SessionSortKey] : undefined;
}

export async function getWebsiteSessions(
  ...args: [websiteId: string, filters: QueryFilters]
): Promise<PageResult<WebsiteSession[]>> {
  return runQuery({
    [PRISMA]: () => relationalQuery(...args),
    [CLICKHOUSE]: () => clickhouseQuery(...args),
  });
}

async function relationalQuery(websiteId: string, filters: QueryFilters) {
  const { pagedRawQuery, parseFilters } = prisma;
  const { search } = filters;
  const { filterQuery, dateQuery, cohortQuery, queryParams } = parseFilters({
    ...filters,
    websiteId,
    search: search ? `%${search}%` : undefined,
  });

  const searchQuery = search
    ? `and (distinct_id ilike {{search}}
           or city ilike {{search}}
           or browser ilike {{search}}
           or os ilike {{search}}
           or device ilike {{search}})`
    : '';

  // orderBy comes from the query string; resolve it through the allowlist before
  // it is interpolated into SQL by pagedRawQuery.
  const orderBy = resolveSessionOrderBy(filters.orderBy);

  return pagedRawQuery(
    `
    select
      session.session_id as "id",
      session.website_id as "websiteId",
      website_event.hostname,
      session.browser,
      session.os,
      session.device,
      session.screen,
      session.language,
      session.country,
      session.region,
      session.city,
      min(website_event.created_at) as "firstAt",
      max(website_event.created_at) as "lastAt",
      count(distinct website_event.visit_id) as "visits",
      sum(case when website_event.event_type = ${EVENT_TYPE.pageView} then 1 else 0 end) as "views",
      sum(case when website_event.event_type = ${EVENT_TYPE.customEvent} then 1 else 0 end) as "events",
      extract(epoch from (max(website_event.created_at) - min(website_event.created_at))) as "duration",
      max(website_event.created_at) as "createdAt"
    from website_event 
    ${cohortQuery}
    join session on session.session_id = website_event.session_id
      and session.website_id = website_event.website_id
    where website_event.website_id = {{websiteId::uuid}}
      and website_event.event_type != ${EVENT_TYPE.performance}
    ${dateQuery}
    ${filterQuery}
    ${searchQuery}
    group by session.session_id, 
      session.website_id, 
      website_event.hostname, 
      session.browser, 
      session.os, 
      session.device, 
      session.screen, 
      session.language, 
      session.country, 
      session.region, 
      session.city
    `,
    queryParams,
    filters,
    FUNCTION_NAME,
    orderBy || 'max(website_event.created_at) desc, session.session_id',
  );
}

async function clickhouseQuery(websiteId: string, filters: QueryFilters) {
  const { pagedRawQuery, parseFilters, getDateStringSQL } = clickhouse;
  const { search } = filters;
  const { filterQuery, dateQuery, cohortQuery, queryParams } = parseFilters(
    {
      ...filters,
      websiteId,
    },
    {
      columns: QUALIFIED_FILTER_COLUMNS,
    },
  );

  const searchQuery = search
    ? `and ((positionCaseInsensitive(website_event.distinct_id, {search:String}) > 0)
           or (positionCaseInsensitive(website_event.city, {search:String}) > 0)
           or (positionCaseInsensitive(website_event.browser, {search:String}) > 0)
           or (positionCaseInsensitive(website_event.os, {search:String}) > 0)
           or (positionCaseInsensitive(website_event.device, {search:String}) > 0))`
    : '';
  const normalizedFilterQuery = filterQuery.replace(
    /referrer_domain != hostname/g,
    'website_event.referrer_domain != website_event.hostname',
  );

  // orderBy comes from the query string; resolve it through the allowlist before
  // it is interpolated into SQL by pagedRawQuery. The two branches below
  // aggregate from different tables, so each supplies its own expression set.
  const orderBy = resolveSessionOrderBy(filters.orderBy, {
    visits: `uniq(visit_id)`,
    views: `sumIf(1, event_type = ${EVENT_TYPE.pageView})`,
    events: `sumIf(1, event_type = ${EVENT_TYPE.customEvent})`,
    duration: `dateDiff('second', min(created_at), max(created_at))`,
    lastAt: `max(created_at)`,
    location: `any(country)`,
    browser: `argMax(browser, created_at)`,
    os: `argMax(os, created_at)`,
    device: `argMax(device, created_at)`,
  });

  // The pre-aggregated branch reads min_time/max_time instead of created_at,
  // so its ordering expressions differ from the raw-event branch above.
  const orderByStats = resolveSessionOrderBy(filters.orderBy, {
    visits: `uniq(visit_id)`,
    views: `sumIf(views, event_type = ${EVENT_TYPE.pageView})`,
    events: `sum(length(event_name))`,
    duration: `dateDiff('second', min(min_time), max(max_time))`,
    lastAt: `max(max_time)`,
    location: `argMax(country, max_time)`,
    browser: `argMax(browser, max_time)`,
    os: `argMax(os, max_time)`,
    device: `argMax(device, max_time)`,
  });

  let sql = '';
  let defaultOrderBy: string | undefined;

  if (EVENT_COLUMNS.some(item => Object.keys(filters).includes(item))) {
    sql = `
    select
      session_id as id,
      any(website_id) as websiteId,
      argMax(hostname, created_at) as hostname,
      argMax(browser, created_at) as browser,
      argMax(os, created_at) as os,
      argMax(device, created_at) as device,
      argMax(screen, created_at) as screen,
      argMax(language, created_at) as language,
      argMax(country, created_at) as country,
      argMax(region, created_at) as region,
      argMax(city, created_at) as city,
      ${getDateStringSQL('min(created_at)')} as firstAt,
      ${getDateStringSQL('max(created_at)')} as lastAt,
      uniq(visit_id) as visits,
      sumIf(1, event_type = ${EVENT_TYPE.pageView}) as views,
      sumIf(1, event_type = ${EVENT_TYPE.customEvent}) as events,
      dateDiff('second', min(created_at), max(created_at)) as duration,
      max(created_at) as createdAt
    from website_event
    ${cohortQuery}
    where website_id = {websiteId:UUID}
      and event_type != ${EVENT_TYPE.performance}
    ${dateQuery}
    ${normalizedFilterQuery}
    ${searchQuery}
    group by session_id
    `;
    defaultOrderBy = orderBy || 'lastAt desc, id';
  } else {
    sql = `
    select
      session_id as id,
      any(website_id) as websiteId,
      argMax(arrayFirst(x -> 1, hostname), max_time) as hostname,
      argMax(browser, max_time) as browser,
      argMax(os, max_time) as os,
      argMax(device, max_time) as device,
      argMax(screen, max_time) as screen,
      argMax(language, max_time) as language,
      argMax(country, max_time) as country,
      argMax(region, max_time) as region,
      argMax(city, max_time) as city,
      ${getDateStringSQL('min(min_time)')} as firstAt,
      ${getDateStringSQL('max(max_time)')} as lastAt,
      uniq(visit_id) as visits,
      sumIf(views, event_type = ${EVENT_TYPE.pageView}) as views,
      sum(length(event_name)) as events,
      dateDiff('second', min(min_time), max(max_time)) as duration,
      max(max_time) as createdAt
    from website_event_stats_hourly as website_event
    ${cohortQuery}
    where website_id = {websiteId:UUID}
      and event_type != ${EVENT_TYPE.performance}
    ${dateQuery}
    ${normalizedFilterQuery}
    ${searchQuery}
    group by session_id
    `;
    defaultOrderBy = orderByStats || 'lastAt desc, id';
  }

  return pagedRawQuery(sql, queryParams, filters, FUNCTION_NAME, defaultOrderBy);
}
