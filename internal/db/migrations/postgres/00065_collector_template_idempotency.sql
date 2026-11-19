-- +goose Up
ALTER TABLE product_templates ADD COLUMN collector_key TEXT;
CREATE UNIQUE INDEX idx_product_templates_collector_key ON product_templates(user_id, collector_key);

-- +goose Down
DROP INDEX idx_product_templates_collector_key;
ALTER TABLE product_templates DROP COLUMN collector_key;
