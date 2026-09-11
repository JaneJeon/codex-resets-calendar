CREATE TABLE dtsm_venues (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state_province TEXT NOT NULL,
  country TEXT NOT NULL,
  zip TEXT NOT NULL,
  url TEXT,
  modified_utc TEXT
);

CREATE TABLE dtsm_organizers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  website TEXT,
  url TEXT,
  modified_utc TEXT
);

CREATE TABLE dtsm_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE dtsm_events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description_html TEXT NOT NULL,
  url TEXT,
  website TEXT,
  start_local TEXT NOT NULL,
  end_local TEXT NOT NULL,
  all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
  status TEXT NOT NULL,
  venue_id INTEGER REFERENCES dtsm_venues(id),
  created_utc TEXT,
  modified_utc TEXT,
  withdrawn_at INTEGER
);

CREATE TABLE dtsm_event_organizers (
  event_id INTEGER NOT NULL REFERENCES dtsm_events(id) ON DELETE CASCADE,
  organizer_id INTEGER NOT NULL REFERENCES dtsm_organizers(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (event_id, organizer_id)
);

CREATE TABLE dtsm_event_categories (
  event_id INTEGER NOT NULL REFERENCES dtsm_events(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES dtsm_categories(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (event_id, category_id)
);

CREATE TABLE dtsm_sync_state (
  calendar TEXT PRIMARY KEY,
  last_success_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0
);

INSERT INTO dtsm_sync_state (calendar) VALUES ('dtsm-events');

CREATE INDEX dtsm_events_end_local_idx ON dtsm_events(end_local);
CREATE INDEX dtsm_events_venue_idx ON dtsm_events(venue_id);
CREATE INDEX dtsm_event_organizers_event_idx ON dtsm_event_organizers(event_id);
CREATE INDEX dtsm_event_organizers_organizer_idx ON dtsm_event_organizers(organizer_id);
CREATE INDEX dtsm_event_categories_event_idx ON dtsm_event_categories(event_id);
CREATE INDEX dtsm_event_categories_category_idx ON dtsm_event_categories(category_id);
