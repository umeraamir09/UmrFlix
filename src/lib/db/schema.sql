-- Fresh UmrFlix schema. Application documents are JSONB; indexed natural keys
-- enforce uniqueness and GIN indexes support scoped document lookups.
BEGIN;


CREATE TABLE IF NOT EXISTS umrflix_my_list (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_my_list_data_idx ON umrflix_my_list USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_my_list_natural_key_idx ON umrflix_my_list ((data->>'userId'), (data->>'itemId'));

ALTER TABLE umrflix_my_list DROP CONSTRAINT IF EXISTS umrflix_my_list_userid_required;

ALTER TABLE umrflix_my_list ADD CONSTRAINT umrflix_my_list_userid_required CHECK (data->>'userId' IS NOT NULL);

ALTER TABLE umrflix_my_list DROP CONSTRAINT IF EXISTS umrflix_my_list_itemid_required;

ALTER TABLE umrflix_my_list ADD CONSTRAINT umrflix_my_list_itemid_required CHECK (data->>'itemId' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_requests (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_requests_data_idx ON umrflix_requests USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_requests_natural_key_idx ON umrflix_requests ((data->>'requestId'));

ALTER TABLE umrflix_requests DROP CONSTRAINT IF EXISTS umrflix_requests_requestid_required;

ALTER TABLE umrflix_requests ADD CONSTRAINT umrflix_requests_requestid_required CHECK (data->>'requestId' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_notifications (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_notifications_data_idx ON umrflix_notifications USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_notifications_natural_key_idx ON umrflix_notifications ((data->>'notifId'));

ALTER TABLE umrflix_notifications DROP CONSTRAINT IF EXISTS umrflix_notifications_notifid_required;

ALTER TABLE umrflix_notifications ADD CONSTRAINT umrflix_notifications_notifid_required CHECK (data->>'notifId' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_cache_store (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_cache_store_data_idx ON umrflix_cache_store USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_cache_store_natural_key_idx ON umrflix_cache_store ((data->>'key'));

ALTER TABLE umrflix_cache_store DROP CONSTRAINT IF EXISTS umrflix_cache_store_key_required;

ALTER TABLE umrflix_cache_store ADD CONSTRAINT umrflix_cache_store_key_required CHECK (data->>'key' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_tmdb_to_tvdb (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_tmdb_to_tvdb_data_idx ON umrflix_tmdb_to_tvdb USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_tmdb_to_tvdb_natural_key_idx ON umrflix_tmdb_to_tvdb ((data->>'tmdbId'));

ALTER TABLE umrflix_tmdb_to_tvdb DROP CONSTRAINT IF EXISTS umrflix_tmdb_to_tvdb_tmdbid_required;

ALTER TABLE umrflix_tmdb_to_tvdb ADD CONSTRAINT umrflix_tmdb_to_tvdb_tmdbid_required CHECK (data->>'tmdbId' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_party_rooms (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_party_rooms_data_idx ON umrflix_party_rooms USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_party_rooms_natural_key_idx ON umrflix_party_rooms ((data->>'partyId'));

ALTER TABLE umrflix_party_rooms DROP CONSTRAINT IF EXISTS umrflix_party_rooms_partyid_required;

ALTER TABLE umrflix_party_rooms ADD CONSTRAINT umrflix_party_rooms_partyid_required CHECK (data->>'partyId' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_user_profiles (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_user_profiles_data_idx ON umrflix_user_profiles USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_user_profiles_natural_key_idx ON umrflix_user_profiles ((data->>'userId'));

ALTER TABLE umrflix_user_profiles DROP CONSTRAINT IF EXISTS umrflix_user_profiles_userid_required;

ALTER TABLE umrflix_user_profiles ADD CONSTRAINT umrflix_user_profiles_userid_required CHECK (data->>'userId' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_user_events (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_user_events_data_idx ON umrflix_user_events USING gin (data jsonb_path_ops);

CREATE TABLE IF NOT EXISTS umrflix_user_feature_profiles (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_user_feature_profiles_data_idx ON umrflix_user_feature_profiles USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_user_feature_profiles_natural_key_idx ON umrflix_user_feature_profiles ((data->>'userId'), (data->>'profileId'));

ALTER TABLE umrflix_user_feature_profiles DROP CONSTRAINT IF EXISTS umrflix_user_feature_profiles_userid_required;

ALTER TABLE umrflix_user_feature_profiles ADD CONSTRAINT umrflix_user_feature_profiles_userid_required CHECK (data->>'userId' IS NOT NULL);

ALTER TABLE umrflix_user_feature_profiles DROP CONSTRAINT IF EXISTS umrflix_user_feature_profiles_profileid_required;

ALTER TABLE umrflix_user_feature_profiles ADD CONSTRAINT umrflix_user_feature_profiles_profileid_required CHECK (data->>'profileId' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_row_impression_stats (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_row_impression_stats_data_idx ON umrflix_row_impression_stats USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_row_impression_stats_natural_key_idx ON umrflix_row_impression_stats ((data->>'rowCategoryKey'));

ALTER TABLE umrflix_row_impression_stats DROP CONSTRAINT IF EXISTS umrflix_row_impression_stats_rowcategorykey_required;

ALTER TABLE umrflix_row_impression_stats ADD CONSTRAINT umrflix_row_impression_stats_rowcategorykey_required CHECK (data->>'rowCategoryKey' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_user_row_fatigue (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_user_row_fatigue_data_idx ON umrflix_user_row_fatigue USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_user_row_fatigue_natural_key_idx ON umrflix_user_row_fatigue ((data->>'userId'), (data->>'profileId'), (data->>'rowCategoryKey'));

ALTER TABLE umrflix_user_row_fatigue DROP CONSTRAINT IF EXISTS umrflix_user_row_fatigue_userid_required;

ALTER TABLE umrflix_user_row_fatigue ADD CONSTRAINT umrflix_user_row_fatigue_userid_required CHECK (data->>'userId' IS NOT NULL);

ALTER TABLE umrflix_user_row_fatigue DROP CONSTRAINT IF EXISTS umrflix_user_row_fatigue_profileid_required;

ALTER TABLE umrflix_user_row_fatigue ADD CONSTRAINT umrflix_user_row_fatigue_profileid_required CHECK (data->>'profileId' IS NOT NULL);

ALTER TABLE umrflix_user_row_fatigue DROP CONSTRAINT IF EXISTS umrflix_user_row_fatigue_rowcategorykey_required;

ALTER TABLE umrflix_user_row_fatigue ADD CONSTRAINT umrflix_user_row_fatigue_rowcategorykey_required CHECK (data->>'rowCategoryKey' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_item_features (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_item_features_data_idx ON umrflix_item_features USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_item_features_natural_key_idx ON umrflix_item_features ((data->>'itemKey'));

ALTER TABLE umrflix_item_features DROP CONSTRAINT IF EXISTS umrflix_item_features_itemkey_required;

ALTER TABLE umrflix_item_features ADD CONSTRAINT umrflix_item_features_itemkey_required CHECK (data->>'itemKey' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_user_serve_log (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_user_serve_log_data_idx ON umrflix_user_serve_log USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_user_serve_log_natural_key_idx ON umrflix_user_serve_log ((data->>'userId'), (data->>'profileId'));

ALTER TABLE umrflix_user_serve_log DROP CONSTRAINT IF EXISTS umrflix_user_serve_log_userid_required;

ALTER TABLE umrflix_user_serve_log ADD CONSTRAINT umrflix_user_serve_log_userid_required CHECK (data->>'userId' IS NOT NULL);

ALTER TABLE umrflix_user_serve_log DROP CONSTRAINT IF EXISTS umrflix_user_serve_log_profileid_required;

ALTER TABLE umrflix_user_serve_log ADD CONSTRAINT umrflix_user_serve_log_profileid_required CHECK (data->>'profileId' IS NOT NULL);

CREATE TABLE IF NOT EXISTS umrflix_sessions (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS umrflix_sessions_data_idx ON umrflix_sessions USING gin (data jsonb_path_ops);

CREATE UNIQUE INDEX IF NOT EXISTS umrflix_sessions_natural_key_idx ON umrflix_sessions ((data->>'sid'));

ALTER TABLE umrflix_sessions DROP CONSTRAINT IF EXISTS umrflix_sessions_sid_required;

ALTER TABLE umrflix_sessions ADD CONSTRAINT umrflix_sessions_sid_required CHECK (data->>'sid' IS NOT NULL);

CREATE INDEX IF NOT EXISTS umrflix_user_events_time_idx ON umrflix_user_events (((data->>'timestamp')::bigint));

CREATE INDEX IF NOT EXISTS umrflix_cache_store_time_idx ON umrflix_cache_store (((data->>'updatedAt')::bigint));

CREATE INDEX IF NOT EXISTS umrflix_sessions_expiry_idx ON umrflix_sessions (((data->>'expiresAt')::bigint));

COMMIT;
