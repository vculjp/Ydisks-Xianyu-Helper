-- +goose Up
ALTER TABLE product_templates ADD COLUMN collector_key VARCHAR(64) NULL;
CREATE UNIQUE INDEX idx_product_templates_collector_key ON product_templates(user_id, collector_key);

-- +goose Down
ALTER TABLE product_templates DROP INDEX idx_product_templates_collector_key;
ALTER TABLE product_templates DROP COLUMN collector_key;
