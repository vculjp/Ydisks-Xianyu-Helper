-- +goose Up
-- 黑马爆品检测雷达：赛道词与同行监控目标配置表 + 商品热度增量快照表。
CREATE TABLE IF NOT EXISTS viral_watch_targets (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL DEFAULT 'keyword',
    target_value TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    publish_days INTEGER NOT NULL DEFAULT 3,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_scanned_at BIGINT NOT NULL DEFAULT 0,
    last_hit_count INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT 0,
    UNIQUE (user_id, target_type, target_value)
);
CREATE INDEX IF NOT EXISTS idx_viral_watch_targets_user ON viral_watch_targets(user_id, enabled, id);

CREATE TABLE IF NOT EXISTS viral_item_snapshots (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    price TEXT NOT NULL DEFAULT '0.00',
    original_price TEXT NOT NULL DEFAULT '',
    pic_url TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '',
    seller_id TEXT NOT NULL DEFAULT '',
    seller_nick TEXT NOT NULL DEFAULT '',
    is_free_shipping INTEGER NOT NULL DEFAULT 0,
    source_type TEXT NOT NULL DEFAULT 'keyword',
    source_label TEXT NOT NULL DEFAULT '',
    publish_time_unix BIGINT NOT NULL DEFAULT 0,
    first_seen_at BIGINT NOT NULL DEFAULT 0,
    first_want_count INTEGER NOT NULL DEFAULT 0,
    prev_seen_at BIGINT NOT NULL DEFAULT 0,
    prev_want_count INTEGER NOT NULL DEFAULT 0,
    latest_seen_at BIGINT NOT NULL DEFAULT 0,
    latest_want_count INTEGER NOT NULL DEFAULT 0,
    delta_want INTEGER NOT NULL DEFAULT 0,
    daily_velocity_x100 INTEGER NOT NULL DEFAULT 0,
    viral_score INTEGER NOT NULL DEFAULT 0,
    scan_count INTEGER NOT NULL DEFAULT 1,
    UNIQUE (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_viral_snapshots_user_score ON viral_item_snapshots(user_id, viral_score DESC);
CREATE INDEX IF NOT EXISTS idx_viral_snapshots_user_delta ON viral_item_snapshots(user_id, delta_want DESC);
CREATE INDEX IF NOT EXISTS idx_viral_snapshots_user_velocity ON viral_item_snapshots(user_id, daily_velocity_x100 DESC);

-- +goose Down
DROP TABLE IF EXISTS viral_item_snapshots;
DROP TABLE IF EXISTS viral_watch_targets;
