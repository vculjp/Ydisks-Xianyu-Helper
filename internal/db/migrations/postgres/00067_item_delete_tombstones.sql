-- +goose Up
-- 商品显式删除墓碑：记录用户主动删除的商品 ID，防止平台列表同步把同一 ID 复活。
CREATE TABLE IF NOT EXISTS item_delete_tombstones (
    cookie_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    created_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (cookie_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_item_delete_tombstones_cookie ON item_delete_tombstones(cookie_id);

-- +goose Down
DROP TABLE IF EXISTS item_delete_tombstones;
