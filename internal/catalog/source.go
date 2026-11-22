// Package catalog 定义公开商品采集与模板发布之间可安全流转的原始商品发布信息，不包含账号凭证或卖家私有资料。
package catalog

// Category 是平台实际返回的商品类目字段；频道 ID 不存在时不得由名称或普通类目 ID 猜测。
type Category struct {
	CatID        string `json:"cat_id"`
	CatName      string `json:"cat_name"`
	ChannelCatID string `json:"channel_cat_id"`
	TBCatID      string `json:"tb_cat_id"`
}

// Complete 表示来源商品提供了发布所需的类目 ID、名称和频道 ID。
func (c Category) Complete() bool {
	return c.CatID != "" && c.CatName != "" && c.ChannelCatID != ""
}

// Attribute 是详情页公开展示的商品属性名和值；不会未经校验直接转换为发布协议参数。
type Attribute struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// SpecValue 保存原商品规格值及对应的图片链接，链接仅供用户授权后下载到本地资源库。
type SpecValue struct {
	Value    string `json:"value"`
	ImageURL string `json:"image_url"`
}

// Spec 是来源商品的一个真实规格维度，不臆造商品未返回的尺码、颜色等值。
type Spec struct {
	Name   string      `json:"name"`
	Values []SpecValue `json:"values"`
}

// SKU 是来源商品明确给出的规格组合、实际售价与当前可用库存；缺失时不创建可发布 SKU。
type SKU struct {
	ValueLabels []string `json:"value_labels"`
	Price       string   `json:"price"`
	Quantity    int      `json:"quantity"`
}

// SourceInfo 是原商品发布信息快照；缺失信息以 Missing 明确列出，不回填猜测值。
// 该快照仅保存商品可公开展示的资料，不保存原卖家的 Cookie、地址坐标或私有请求体。
type SourceInfo struct {
	ItemID      string      `json:"item_id"`
	WebURL      string      `json:"web_url"`
	Category    Category    `json:"category"`
	Specs       []Spec      `json:"specs"`
	SKUs        []SKU       `json:"skus"`
	Quantity    int         `json:"quantity"`
	PostageMode string      `json:"postage_mode"`
	Postage     string      `json:"postage"`
	Area        string      `json:"area"`
	Attributes  []Attribute `json:"attributes"`
	Missing     []string    `json:"missing"`
}

// NormalizeCollections 保证前后端和 JSON 数据库存取中不存在 null 数组，旧模板也能安全读取。
func (s *SourceInfo) NormalizeCollections() {
	if s.Specs == nil {
		s.Specs = []Spec{}
	}
	if s.SKUs == nil {
		s.SKUs = []SKU{}
	}
	if s.Attributes == nil {
		s.Attributes = []Attribute{}
	}
	if s.Missing == nil {
		s.Missing = []string{}
	}
	for i := range s.Specs {
		if s.Specs[i].Values == nil {
			s.Specs[i].Values = []SpecValue{}
		}
	}
	for i := range s.SKUs {
		if s.SKUs[i].ValueLabels == nil {
			s.SKUs[i].ValueLabels = []string{}
		}
	}
}
