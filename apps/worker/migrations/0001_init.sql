-- Cloudflare D1 Migration for FeedMeBots

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  webhook_url TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  is_house INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hands (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  seed TEXT NOT NULL,
  small_blind INTEGER NOT NULL,
  big_blind INTEGER NOT NULL,
  dealer_seat INTEGER NOT NULL,
  community_cards TEXT NOT NULL,
  action_history TEXT NOT NULL,
  winners TEXT NOT NULL,
  total_pot INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hand_players (
  hand_id TEXT NOT NULL,
  seat_index INTEGER NOT NULL,
  bot_id TEXT NOT NULL,
  starting_stack INTEGER NOT NULL,
  final_stack INTEGER NOT NULL,
  net_chips INTEGER NOT NULL,
  hole_cards TEXT,
  rank_description TEXT,
  PRIMARY KEY (hand_id, seat_index),
  FOREIGN KEY (hand_id) REFERENCES hands(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  winner_bot_id TEXT NOT NULL,
  total_hands INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  hand_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  error_type TEXT NOT NULL,
  payload_sent TEXT NOT NULL,
  raw_response TEXT,
  error_message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hands_created ON hands(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hand_players_bot ON hand_players(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_errors_bot ON bot_errors(bot_id, created_at DESC);

-- Seed baseline house bots
INSERT OR IGNORE INTO bots (id, name, api_key, webhook_url, is_active, is_house, created_at, updated_at)
VALUES 
  ('house_tag_1', 'TightAggressiveBot', 'key_house_tag_1', 'local', 1, 1, 1700000000000, 1700000000000),
  ('house_station_1', 'CallingStationBot', 'key_house_station_1', 'local', 1, 1, 1700000000000, 1700000000000),
  ('house_random_1', 'RandomBot', 'key_house_random_1', 'local', 1, 1, 1700000000000, 1700000000000);
