-- +goose Up
ALTER TABLE product_templates ADD COLUMN source_json TEXT NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE product_templates DROP COLUMN source_json;
