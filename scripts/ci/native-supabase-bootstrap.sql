-- The roles and schemas the iOS lane's native Supabase stack needs in the
-- `postgres` database before GoTrue v2.183.0 and storage-api v1.32.0 run their
-- own migrations. Run once, by the bootstrap superuser `supabase_admin`, on a
-- fresh cluster.
--
-- Each item matches what the supabase/postgres 17.6.1.054 image leaves after
-- its init scripts and migrations, for the parts GoTrue, storage-api and the
-- share-card lane use. The image's realtime, replication, read-only and
-- dashboard roles, its extensions schema (uuid-ossp, pgcrypto), pg_cron, pg_net,
-- pgsodium, vault, pg_graphql and PostgREST setup are left out: nothing this
-- lane runs uses them.
\set ON_ERROR_STOP on

-- API roles. PostgREST is not run, but storage-api switches to these per request.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

-- The role storage-api hops through on its way to the API roles.
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;

-- GoTrue's database user; its migrations create everything in `auth`.
CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE PASSWORD 'postgres';
ALTER ROLE supabase_auth_admin SET search_path = auth;

-- storage-api's database user; its migrations create everything in `storage`.
CREATE ROLE supabase_storage_admin LOGIN NOINHERIT CREATEROLE PASSWORD 'postgres';
ALTER ROLE supabase_storage_admin SET search_path = storage;
GRANT authenticator TO supabase_storage_admin;

-- The application user, demoted the way the image demotes it
-- (10000000000000_demote-postgres.sql). pg_signal_backend lets the share-card
-- cleanup end the sessions of the database it drops WITH (FORCE).
CREATE ROLE postgres LOGIN PASSWORD 'postgres'
  NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
GRANT pg_signal_backend TO postgres;

CREATE SCHEMA auth;
GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin;
CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin;
GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated, service_role;

-- storage-api's migration ledger, created ahead of storage-api as the image does
-- (00000000000002-storage-schema.sql), with postgres-migrations' own definition.
-- storage-api v1.32.0 runs CREATE SCHEMA IF NOT EXISTS storage whenever this
-- table is missing, and that statement needs CREATE on the database, which
-- supabase_storage_admin does not hold in the image either.
SET ROLE supabase_storage_admin;
CREATE TABLE storage.migrations (
  id integer PRIMARY KEY,
  name varchar(100) UNIQUE NOT NULL,
  hash varchar(40) NOT NULL,
  executed_at timestamp DEFAULT current_timestamp
);
RESET ROLE;
