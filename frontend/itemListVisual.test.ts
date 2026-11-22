import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe,expect,test } from 'vitest';

const itemList = readFileSync(resolve(__dirname, 'app/features/items/pages/ItemList.tsx'), 'utf8'); /* itemList 表示当前商品List。 */
const filterCSS = readFileSync(resolve(__dirname, 'item-list-filter-layout.css'), 'utf8'); /* filterCSS 表示商品筛选区最终布局覆盖样式。 */
const indexEntry = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8'); /* indexEntry 表示前端样式入口装配顺序。 */

describe('item list primary action colors', () => {
  test('uses the shared primary blue for batch publishing', () => {
    expect(itemList).toContain('bg-brand text-white hover:bg-brand-highlight');
    expect(itemList).not.toContain('bg-blue-600 text-white hover:bg-blue-700');
  } /* 测试回调断言批量发布使用共享品牌主色。 */);

  test('uses the lighter emerald tone for publishing actions', () => {
    expect(itemList).toContain('bg-emerald-500 text-white hover:bg-emerald-600');
    expect(itemList).not.toContain('bg-emerald-600 text-white hover:bg-emerald-700');
  } /* 测试回调断言发布操作使用约定的浅色绿色令牌。 */);
} /* 测试套件回调汇总商品列表视觉令牌契约。 */);

describe('item list filter layout', () => {
  test('keeps filters and actions on one reference-aligned toolbar row', () => {
    // toolbarBlock 是唯一一段商品筛选工具栏样式，防止后置规则再次覆盖布局。
    const toolbarBlock = filterCSS.match(/\.product-filter-toolbar\s*\{([^}]*)\}/)?.[1] ?? '';
    // actionsBlock 是同一行右侧操作组的样式声明。
    const actionsBlock = filterCSS.match(/\.product-filter-actions\s*\{([^}]*)\}/)?.[1] ?? '';
    // filterRowBlock 是查询条件行声明，必须保持参考页的紧凑间距和控件宽度。
    const filterRowBlock = filterCSS.match(/\.product-filter-row\s*\{([^}]*)\}/)?.[1] ?? '';
    expect((filterCSS.match(/\.product-filter-toolbar\s*\{/g) || []).length).toBe(1);
    expect(toolbarBlock).toContain('flex-direction: row;');
    expect(toolbarBlock).toContain('flex-wrap: wrap;');
    expect(toolbarBlock).toContain('padding-top: 15px;');
    expect(filterCSS).not.toContain('flex: 1 1 720px');
    expect(filterRowBlock).toContain('display: flex;');
    expect(filterRowBlock).toContain('flex-wrap: wrap;');
    expect(filterRowBlock).not.toContain('grid-template-columns');
    expect(filterCSS).toContain('width: min(250px,28.8vw);');
    expect(actionsBlock).toContain('width: auto;');
    expect(actionsBlock).toContain('margin-left: auto;');
    expect(actionsBlock).toContain('border: 0;');
    expect(itemList).not.toContain('product-strip-rule');
    expect(itemList).toContain('product-strip-filter');
    expect(itemList).toContain('aria-label="商品规则筛选"');
    expect(indexEntry.indexOf("'./item-list-filter-layout.css'")).toBeGreaterThan(indexEntry.indexOf("'./index.css'"));
  } /* 测试回调断言查询条件与功能按钮同排，窄屏自然换行。 */);

  test('keeps the reference filter row narrow and exposes every table column', () => {
    // tableCSS 是商品表格的最终列宽与粘性列规则，操作列不得覆盖其他字段。
    const tableCSS = readFileSync(resolve(__dirname, 'index.css'), 'utf8');
    expect(tableCSS).toContain('min-width: 1430px;');
    expect(tableCSS).not.toContain('.products-view .product-table th:last-child,\n.products-view .product-table td:last-child {\n  position: sticky;');
    expect(itemList).toContain('className="product-query-button">查询</button>');
    expect(itemList).toContain('className="product-strip-filter"');
  } /* 测试回调锁定参考查询行及完整表格列可见性。 */);
} /* 测试套件回调锁定商品筛选区的行列布局契约。 */);
