-- +goose Up
-- 黑马爆品检测雷达：赛道词与同行监控目标配置表 + 商品热度增量快照表。
CREATE TABLE IF NOT EXISTS viral_watch_targets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    target_type VARCHAR(32) NOT NULL DEFAULT 'keyword',
    target_value VARCHAR(191) NOT NULL,
    label VARCHAR(255) NOT NULL DEFAULT '',
    publish_days INTEGER NOT NULL DEFAULT 3,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_scanned_at BIGINT NOT NULL DEFAULT 0,
    last_hit_count INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_viral_watch_targets_user (user_id, target_type, target_value),
    INDEX idx_viral_watch_targets_user (user_id, enabled, id),
    CONSTRAINT fk_viral_watch_targets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS viral_item_snapshots (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    title VARCHAR(512) NOT NULL DEFAULT '',
    price VARCHAR(64) NOT NULL DEFAULT '0.00',
    original_price VARCHAR(64) NOT NULL DEFAULT '',
    pic_url TEXT NOT NULL,
    area VARCHAR(128) NOT NULL DEFAULT '',
    seller_id VARCHAR(64) NOT NULL DEFAULT '',
    seller_nick VARCHAR(128) NOT NULL DEFAULT '',
    is_free_shipping INTEGER NOT NULL DEFAULT 0,
    source_type VARCHAR(32) NOT NULL DEFAULT 'keyword',
    source_label VARCHAR(255) NOT NULL DEFAULT '',
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
    UNIQUE KEY uk_viral_snapshots_user_item (user_id, item_id),
    INDEX idx_viral_snapshots_user_score (user_id, viral_score),
    INDEX idx_viral_snapshots_user_delta (user_id, delta_want),
    INDEX idx_viral_snapshots_user_velocity (user_id, daily_velocity_x100),
    CONSTRAINT fk_viral_snapshots_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- +goose Down
DROP TABLE IF EXISTS viral_item_snapshots;
DROP TABLE IF EXISTS viral_watch_targets;
