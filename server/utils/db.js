import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// DNS Manager's own data: accounts, sessions and the Cloudflare tokens each account has added
// (encrypted, see secrets.js). One SQLite file in the data directory, NUXT_DATA_DIR or .data,
// which a container should keep on a volume. Node's built-in SQLite needs no native build.

// Each migration runs once, in order, inside a transaction. Never edit one that has shipped;
// add another.
const MIGRATIONS = [
	`create table users (
		id integer primary key,
		username text not null unique collate nocase,
		password_hash text not null,
		created_at text not null default (datetime('now')),
		disabled_at text
	);
	create table sessions (
		id text primary key,
		user_id integer not null references users(id) on delete cascade,
		created_at text not null default (datetime('now')),
		expires_at text not null,
		last_seen_at text not null default (datetime('now'))
	);
	create index sessions_user on sessions(user_id);
	create table connections (
		id integer primary key,
		user_id integer not null references users(id) on delete cascade,
		label text not null,
		token_enc text not null,
		token_hint text not null,
		cf_token_id text,
		created_at text not null default (datetime('now')),
		checked_at text
	);
	create index connections_user on connections(user_id);`,
	// Sharing: an owner shares some of their zones with another account. The invite link's
	// value is stored only as a hash and cleared once used; member_id is set when it's accepted.
	// Levels are JSON objects of area → level (shared/utils/access.js).
	`create table shares (
		id integer primary key,
		owner_id integer not null references users(id) on delete cascade,
		member_id integer references users(id) on delete cascade,
		label text not null,
		defaults text not null,
		show_prices integer not null default 0,
		invite_hash text unique,
		invite_expires_at text,
		created_at text not null default (datetime('now')),
		accepted_at text
	);
	create index shares_owner on shares(owner_id);
	create index shares_member on shares(member_id);
	create table share_zones (
		share_id integer not null references shares(id) on delete cascade,
		zone_id text not null,
		zone_name text not null,
		overrides text not null default '{}',
		price_amount text,
		price_currency text,
		primary key (share_id, zone_id)
	);
	create index share_zones_zone on share_zones(zone_id);`,
	`alter table connections add column priority integer not null default 0;
	update connections set priority = id;`,
	// Older bucket names can collide. An owner must associate one with exactly one zone.
	`create table zone_buckets (
		zone_id text primary key,
		account_id text not null,
		bucket_name text not null,
		unique (account_id, bucket_name)
	);`
]

let db = null

export const dataDir = () => resolve(useRuntimeConfig().dataDir || '.data')

export function useDb() {
	if (db) return db
	const dir = dataDir()
	mkdirSync(dir, { recursive: true, mode: 0o700 })
	db = new DatabaseSync(join(dir, 'dns-manager.sqlite'))
	db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;')
	db.exec('create table if not exists migrations (id integer primary key, run_at text not null)')
	const done = new Set(
		db
			.prepare('select id from migrations')
			.all()
			.map((row) => row.id)
	)
	MIGRATIONS.forEach((sql, index) => {
		const id = index + 1
		if (done.has(id)) return
		db.exec('begin')
		try {
			db.exec(sql)
			db.prepare("insert into migrations (id, run_at) values (?, datetime('now'))").run(id)
			db.exec('commit')
		} catch (error) {
			db.exec('rollback')
			throw error
		}
	})
	return db
}
