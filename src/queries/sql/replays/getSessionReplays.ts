import clickhouse from '@/lib/clickhouse';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';
import type { PageResult, QueryFilters, SessionReplaySummary } from '@/lib/types';

const FUNCTION_NAME = 'getSessionReplays';

// Whitelist of client-facing sort keys. `orderBy` arrives from the query string
// and pagedRawQuery interpolates filters.orderBy directly into raw SQL, so it
// must never be passed through unvalidated. Each key maps to a fixed expression
// over the grouped columns; unknown keys fall back to the default ordering.
const REPLAY_SORT_KEYS = [
  'duration',
  'eventCount',
  'location',
  'browser',
  'os',
  'device',
  'createdAt',
] as const;

export type ReplaySortKey = (typeof REPLAY_SORT_KEYS)[number];

const POSTGRES_SORT_COLUMNS: Record<ReplaySortKey, string> = {
  duration: `sum(extract(epoch from sr.ended_at - sr.started_at) * 1000)`,
  eventCount: `sum(sr.event_count)`,
  location: `session.country`,
  browser: `session.browser`,
  os: `session.os`,
  device: `session.device`,
  createdAt: `max(sr.created_at)`,
};

const CLICKHOUSE_SORT_COLUMNS: Record<ReplaySortKey, string> = {
  duration: `toInt64(sum(toUnixTimestamp64Milli(session_replay.ended_at) - toUnixTimestamp64Milli(session_replay.started_at)))`,
  eventCount: `sum(session_replay.event_count)`,
  location: `website_event.country`,
  browser: `website_event.browser`,
  os: `website_event.os`,
  device: `website_event.device`,
  createdAt: `max(session_replay.created_at)`,
};

/**
 * Maps a client-supplied `orderBy` to a safe SQL expression, with the sort
 * direction appended. Returns undefined for unknown keys.
 *
 * Object.hasOwn is used rather than `in` so inherited Object.prototype keys
 * (`__proto__`, `constructor`, `toString`) are rejected too — `in` walks the
 * prototype chain and would let those through as non-SQL values.
 */
export function resolveReplayOrderBy(
  orderBy: string | undefined,
  columns: Record<ReplaySortKey, string> = POSTGRES_SORT_COLUMNS,
) {
  return orderBy && Object.hasOwn(columns, orderBy) ? columns[orderBy as ReplaySortKey] : undefined;
}

export function getSessionReplays(
  ...args: [websiteId: string, filters: QueryFilters, sessionId?: string]
): Promise<PageResult<SessionReplaySummary[]>> {
  return runQuery({
    [PRISMA]: () => relationalQuery(...args),
    [CLICKHOUSE]: () => clickhouseQuery(...args),
  });
}

async function relationalQuery(websiteId: string, filters: QueryFilters, sessionId?: string) {
  const { pagedRawQuery, parseFilters } = prisma;
  const { search, minDuration } = filters;
  const minDurationMs = minDuration && minDuration > 0 ? minDuration * 1000 : undefined;
  const { filterQuery, cohortQuery, queryParams, joinSessionQuery } = parseFilters({
    ...filters,
    websiteId,
    search: search ? `%${search}%` : undefined,
  });

  const joinQuery =
    filterQuery || cohortQuery
      ? `join (select distinct website_event.website_id, website_event.session_id, website_event.visit_id
               from website_event
               ${joinSessionQuery}
               ${cohortQuery}
               where website_event.website_id = {{websiteId::uuid}}
                  and website_event.created_at between {{startDate}} and {{endDate}}
                  ${filterQuery}) website_event
        on website_event.website_id = sr.website_id
          and website_event.session_id = sr.session_id
          and website_event.visit_id = sr.visit_id`
      : '';

  const sessionFilter = sessionId ? 'and sr.session_id = {{sessionId::uuid}}' : '';

  const searchQuery = search
    ? `and (session.distinct_id ilike {{search}}
           or session.city ilike {{search}}
           or session.browser ilike {{search}}
           or session.os ilike {{search}}
           or session.device ilike {{search}})`
    : '';

  const havingQuery = minDurationMs
    ? `having sum(extract(epoch from sr.ended_at - sr.started_at) * 1000) >= {{minDurationMs}}`
    : '';

  // pagedRawQuery reads filters.orderBy itself and interpolates it into SQL, so
  // the raw value must not reach it. Resolve through the allowlist, strip orderBy
  // from the filters, and build the clause here with the direction baked in --
  // pagedRawQuery only appends a direction on its own orderBy branch, never to
  // defaultOrderBy. The hardcoded "order by max(sr.created_at) desc" below the
  // GROUP BY is removed so a second ORDER BY clause is never emitted.
  const orderBy = resolveReplayOrderBy(filters.orderBy);
  const pagingFilters = { ...filters, orderBy: undefined };
  const direction = filters.sortDescending ? 'desc' : 'asc';
  const orderClause = orderBy ? `${orderBy} ${direction}` : 'max(sr.created_at) desc';

  return pagedRawQuery(
    `
    select
      sr.visit_id as "id",
      sr.session_id as "sessionId",
      sr.website_id as "websiteId",
      session.browser,
      session.os,
      session.device,
      session.country,
      session.city,
      sum(sr.event_count) as "eventCount",
      count(sr.replay_id) as "chunkCount",
      min(sr.started_at) as "startedAt",
      max(sr.ended_at) as "endedAt",
      sum(extract(epoch from sr.ended_at - sr.started_at) * 1000)::bigint as "duration",
      max(sr.created_at) as "createdAt"
    from session_replay sr
    join session on session.session_id = sr.session_id
      and session.website_id = sr.website_id
    ${joinQuery}
    where sr.website_id = {{websiteId::uuid}}
      and sr.created_at between {{startDate}} and {{endDate}}
    ${sessionFilter}
    ${searchQuery}
    group by sr.visit_id,
      sr.session_id,
      sr.website_id,
      session.browser,
      session.os,
      session.device,
      session.country,
      session.city
    ${havingQuery}
    order by ${orderClause}
    `,
    { ...queryParams, sessionId, minDurationMs },
    pagingFilters,
    FUNCTION_NAME,
  );
}

async function clickhouseQuery(websiteId: string, filters: QueryFilters, sessionId?: string) {
  const { pagedRawQuery, parseFilters } = clickhouse;
  const { search, minDuration } = filters;
  const minDurationMs = minDuration && minDuration > 0 ? minDuration * 1000 : undefined;
  const { queryParams, cohortQuery, filterQuery } = parseFilters({
    ...filters,
    websiteId,
  });

  const sessionFilter = sessionId ? 'and session_replay.session_id = {sessionId:UUID}' : '';

  const searchQuery = search
    ? `and ((positionCaseInsensitive(distinct_id, {search:String}) > 0)
           or (positionCaseInsensitive(city, {search:String}) > 0)
           or (positionCaseInsensitive(browser, {search:String}) > 0)
           or (positionCaseInsensitive(os, {search:String}) > 0)
           or (positionCaseInsensitive(device, {search:String}) > 0))`
    : '';

  const havingQuery = minDurationMs
    ? `having toInt64(sum(toUnixTimestamp64Milli(session_replay.ended_at) - toUnixTimestamp64Milli(session_replay.started_at))) >= {minDurationMs:Int64}`
    : '';

  // See the note in relationalQuery. ClickHouse's pagedRawQuery has no
  // defaultOrderBy parameter, so the clause is appended to the statement itself
  // and the sanitized filters are passed down.
  const orderBy = resolveReplayOrderBy(filters.orderBy, CLICKHOUSE_SORT_COLUMNS);
  const pagingFilters = { ...filters, orderBy: undefined };
  const direction = filters.sortDescending ? 'desc' : 'asc';
  const orderClause = orderBy ? `${orderBy} ${direction}` : 'max(created_at) desc';

  return pagedRawQuery(
    `
    select
      session_replay.visit_id as id,
      session_replay.session_id as sessionId,
      session_replay.website_id as websiteId,
      website_event.browser,
      website_event.os,
      website_event.device,
      website_event.country,
      website_event.city,
      sum(session_replay.event_count) as eventCount,
      count(session_replay.replay_id) as chunkCount,
      min(session_replay.started_at) as startedAt,
      max(session_replay.ended_at) as endedAt,
      toInt64(sum(toUnixTimestamp64Milli(session_replay.ended_at) - toUnixTimestamp64Milli(session_replay.started_at))) as duration,
      max(session_replay.created_at) as createdAt
    from session_replay
    join (
      select distinct website_id, session_id, visit_id, browser, os, device, country, city
      from website_event
      ${cohortQuery}
      where website_id = {websiteId:UUID}
        and created_at between {startDate:DateTime64} and {endDate:DateTime64}
        ${filterQuery}
        ${searchQuery}
    ) website_event
    on website_event.session_id = session_replay.session_id
      and website_event.website_id = session_replay.website_id
      and website_event.visit_id = session_replay.visit_id
    where session_replay.website_id = {websiteId:UUID}
        and session_replay.created_at between {startDate:DateTime64} and {endDate:DateTime64}
    ${sessionFilter}
    group by session_replay.visit_id, session_replay.session_id, session_replay.website_id, website_event.browser, website_event.os, website_event.device, website_event.country, website_event.city
    ${havingQuery}
    order by ${orderClause}
    `,
    { ...queryParams, sessionId, minDurationMs },
    pagingFilters,
    FUNCTION_NAME,
  );
}
