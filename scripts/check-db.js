/* eslint-disable no-console */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import chalk from 'chalk';
import { PrismaClient } from '../generated/prisma/client.js';

const MIN_VERSION = '9.4.0';
const MIN_VERSION_NUM = 90400;

// Startup readiness. The app and database containers start concurrently, so
// PostgreSQL may still be initializing the first time we run. A plain connect
// is not enough: Postgres accepts TCP connections while starting up, then
// refuses queries with SQLSTATE 57P03 ("the database system is starting up").
// Poll until it can actually serve a query so we never report a transient
// startup condition as a hard failure.
const READY_ATTEMPTS = Number(process.env.DB_READY_ATTEMPTS || 15);
const READY_DELAY_MS = Number(process.env.DB_READY_DELAY_MS || 2000);

if (process.env.SKIP_DB_CHECK) {
  console.log('Skipping database check.');
  process.exit(0);
}

const url = new URL(process.env.DATABASE_URL);

const adapter = new PrismaPg(
  { connectionString: url.toString() },
  { schema: url.searchParams.get('schema') },
);

const prisma = new PrismaClient({ adapter });

function success(msg) {
  console.log(chalk.greenBright(`✓ ${msg}`));
}

function error(msg) {
  console.log(chalk.redBright(`✗ ${msg}`));
}

function warn(msg) {
  console.log(chalk.yellowBright(`! ${msg}`));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForDatabase() {
  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt++) {
    try {
      // A trivial query, not just $connect — this is what distinguishes "socket
      // open" from "Postgres is actually serving queries".
      await prisma.$queryRaw`select 1`;
      success('Database is ready.');
      return;
    } catch (e) {
      if (attempt === READY_ATTEMPTS) {
        // Out of attempts. Report why and let the normal checks below produce
        // the real error rather than swallowing it.
        warn(`Database not ready after ${attempt} attempts: ${e.message}`);
        return;
      }
      await sleep(READY_DELAY_MS);
    }
  }
}

async function checkEnv() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined.');
  } else {
    success('DATABASE_URL is defined.');
  }

  if (process.env.REDIS_URL) {
    success('REDIS_URL is defined.');
  }
}

async function checkConnection() {
  try {
    await prisma.$connect();

    success('Database connection successful.');
  } catch (e) {
    throw new Error(`Unable to connect to the database: ${e.message}`);
  }
}

async function checkDatabaseVersion() {
  const query = await prisma.$queryRaw`select current_setting('server_version_num') as version_num`;
  const version = Number(query[0]?.version_num);

  if (!Number.isFinite(version)) {
    throw new Error('Unable to determine database version.');
  }

  if (version < MIN_VERSION_NUM) {
    throw new Error(
      `Database version is not compatible. Please upgrade to ${MIN_VERSION} or greater.`,
    );
  }

  success('Database version check successful.');
}

async function applyMigration() {
  if (!process.env.SKIP_DB_MIGRATION) {
    const directUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
    console.log(
      execSync('prisma migrate deploy', {
        env: { ...process.env, DATABASE_URL: directUrl },
      }).toString(),
    );

    success('Database is up to date.');
  }
}

(async () => {
  let err = false;
  for (const fn of [checkEnv, waitForDatabase, checkConnection, checkDatabaseVersion, applyMigration]) {
    try {
      await fn();
    } catch (e) {
      error(e.message);
      err = true;
    } finally {
      if (err) {
        process.exit(1);
      }
    }
  }
})();
