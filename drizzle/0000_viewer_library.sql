CREATE TABLE viewer_library (
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  title_id TEXT NOT NULL,
  season INTEGER NOT NULL DEFAULT 0,
  episode INTEGER NOT NULL DEFAULT 0,
  item TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(owner, kind, title_id, season, episode)
);
