-- +goose Up
ALTER TABLE product_templates ADD COLUMN source_json LONGTEXT NULL;
UPDATE product_templates SET source_json = '{}' WHERE source_json IS NULL OR source_json = '';

-- +goose Down
ALTER TABLE product_templates DROP COLUMN source_json;
