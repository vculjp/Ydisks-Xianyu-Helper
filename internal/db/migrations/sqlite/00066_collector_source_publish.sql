-- +goose Up
-- 采集到的原商品发布资料快照（类目、规格、运费、来源、待核实字段）；只读来源信息不参与账号凭证存储。
ALTER TABLE product_templates ADD COLUMN source_json TEXT NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE product_templates DROP COLUMN source_json;
