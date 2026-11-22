// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,test,vi } from 'vitest';
import type { Item, ShippingRule } from '../api';

// itemListMocks 保存商品列表页面使用的 API 和 Hook 替身。
const itemListMocks = vi.hoisted(/* itemListMockFactory 创建列表加载与 AI 配置替身。 */ () => ({
  /** editorOpen 控制商品动作替身是否要求渲染编辑页面。 */
  editorOpen: false,
  /** editorItem 是当前编辑的非敏感商品样本；null 表示没有打开编辑。 */
  editorItem: null as Item | null,
  getAccountDetails: vi.fn(),
  getItemPublishBatches: vi.fn(),
  getItems: vi.fn(),
  getShippingRules: vi.fn(),
  getItemAISettings: vi.fn(),
  updateItemAISettings: vi.fn(),
}));

vi.mock('../api', /* itemListAPIMockFactory 提供页面和真实 AI 弹窗共享的 API 替身。 */ () => ({
  getAccountDetails: itemListMocks.getAccountDetails,
  getItemPublishBatches: itemListMocks.getItemPublishBatches,
  getItems: itemListMocks.getItems,
  getShippingRules: itemListMocks.getShippingRules,
  getItemAISettings: itemListMocks.getItemAISettings,
  updateItemAISettings: itemListMocks.updateItemAISettings,
  itemErrorMessage: /* itemErrorMessageMock 将 Error 转换为用户可见文本。 */ (/* error 是 API 替身抛出的失败原因。 */ error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}));

vi.mock('../hooks', /* itemPublishBatchHookMockFactory 提供关闭状态的批量发布流程。 */ () => ({
  useItemPublishBatch: /* itemPublishBatchHookMock 返回页面解构所需的稳定批量状态。 */ () => ({
    showBatchModal: false, batchLoading: false, batchPhase: 'upload', batchFile: null, setBatchFile: vi.fn(), batchImagesZip: null, setBatchImagesZip: vi.fn(),
    batchCategoryKeyword: '', setBatchCategoryKeyword: vi.fn(), batchCategoryLoading: false,
    batchFallbackCategory: { catId: '', catName: '', channelCatId: '', tbCatId: '' }, setBatchFallbackCategory: vi.fn(),
    batchPreview: null, batchDetail: null, recentBatch: null, setRecentBatch: vi.fn(), batchLocations: [], batchLocation: null,
    batchPublishIntervalSeconds: 5, setBatchPublishIntervalSeconds: vi.fn(), setBatchLocations: vi.fn(), setBatchLocation: vi.fn(),
    openBatchModal: vi.fn(), handleRecommendBatchCategory: vi.fn(), openRecentBatchResult: vi.fn(), handlePreviewBatch: vi.fn(), handleStartBatch: vi.fn(),
    handleCancelBatch: vi.fn(), abandonBatchPreview: vi.fn(), closeBatchModal: vi.fn(), handleRetryBatchFailed: vi.fn(),
  }),
}));

vi.mock('../itemActions', /* itemActionsMockFactory 提供关闭状态的商品编辑与发布动作。 */ () => ({
  useItemActions: /* itemActionsHookMock 返回页面解构所需的稳定普通商品状态。 */ () => ({
    loading: false, publishing: false, showEditModal: itemListMocks.editorOpen, setShowEditModal: vi.fn(), showAddModal: false, setShowAddModal: vi.fn(),
    showPublishModal: false, setShowPublishModal: vi.fn(), locationLoading: false, publishLocations: [], setPublishLocations: vi.fn(),
    publishLocation: null, setPublishLocation: vi.fn(), publishCategoryKeyword: '', setPublishCategoryKeyword: vi.fn(), publishCategoryLoading: false,
    publishCategory: null, setPublishCategory: vi.fn(), selectedItem: itemListMocks.editorItem, editForm: itemListMocks.editorItem || {}, setEditForm: vi.fn(), addForm: {}, setAddForm: vi.fn(),
    publishForm: { cookie_id: '', title: '', description: '', price: '', original_price: '', quantity: '1', postage_mode: 'free', postage: '', images: [], specs: [], skuRows: [] },
    setPublishForm: vi.fn(), publishImagePreviews: [], handleSync: vi.fn(), handleEdit: vi.fn(), handleSaveEdit: vi.fn(), handleSaveRemoteEdit: vi.fn(), remoteItemBusy: null, handleSetShelf: vi.fn(), handleDelete: vi.fn(),
    handleAddItem: vi.fn(), handlePublishItem: vi.fn(), handleRecommendPublishCategory: vi.fn(), downloadPublishTemplate: vi.fn(), openAddModal: vi.fn(),
    openPublishModal: vi.fn(), locateForPublish: vi.fn(),
  }),
}));

vi.mock('../components/BatchPhaseIndicator', /* batchIndicatorMockFactory 隐藏本用例无关的批量阶段组件。 */ () => ({ BatchPhaseIndicator: /* BatchPhaseIndicatorMock 不渲染批量阶段。 */ () => null }));
vi.mock('../components/ManualLocationPicker', /* locationPickerMockFactory 隐藏本用例无关的地点弹窗。 */ () => ({ ManualLocationPicker: /* ManualLocationPickerMock 不渲染地点弹窗。 */ () => null }));

import ItemList from './ItemList';
import { ItemAISettingsModal } from '../components/ItemAISettingsModal';
import { ItemEditorPage } from '../components/ItemEditorPage';

// itemFixture 是列表 DTO 直接提供 AI 摘要状态的商品样本。
const itemFixture: Item = { id: 'item-1', cookie_id: 'account-1', item_id: 'item-1', item_title: '测试商品', item_price: '99', ai_override: 'enabled' };

// openItemTools 打开批量操作条右侧的“更多操作”菜单，并返回菜单容器。
const openItemTools = () => {
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
  return screen.getByRole('menu', { name: '商品列表工具' });
};

describe('ItemList 商品级 AI 入口', /* itemListAISuite 验证列表摘要、按需读取和保存后局部更新。 */ () => {
  beforeEach(/* itemListMockReset 恢复商品列表和 AI 配置默认响应。 */ () => {
    vi.clearAllMocks();
    itemListMocks.editorOpen = false;
    itemListMocks.editorItem = null;
    window.localStorage.removeItem('ydisks.items.selected_account');
    itemListMocks.getAccountDetails.mockResolvedValue([{ id: 'account-1', enabled: true, auto_confirm: false, remark: '测试账号' }]);
    itemListMocks.getItems.mockResolvedValue([itemFixture]);
    itemListMocks.getShippingRules.mockResolvedValue([]);
    itemListMocks.getItemPublishBatches.mockResolvedValue([]);
    itemListMocks.getItemAISettings.mockResolvedValue({ ai_override: 'enabled', item_context: '材质：全新' });
    itemListMocks.updateItemAISettings.mockResolvedValue({ ai_override: 'disabled', item_context: '材质：全新' });
  });

  afterEach(/* itemListCleanup 清理页面 DOM。 */ () => cleanup());

  test('编辑商品显示参考的独立内容页而不是覆盖列表的弹窗', /* inlineEditorCase 验证编辑时替换内容区域，列表筛选和弹窗遮罩都不再展示。 */ async () => {
    itemListMocks.editorOpen = true;
    itemListMocks.editorItem = itemFixture;
    // view 保存当前页面的根容器，用于验证编辑器留在应用内容区域内。
    const view = render(<ItemList onConfigureDelivery={vi.fn()} itemEditorPage={ItemEditorPage} />);
    await screen.findByRole('heading', { name: '编辑商品' });
    expect(screen.queryByRole('search', { name: '商品筛选' })).toBeNull();
    expect(within(view.container).getByRole('heading', { name: '编辑商品' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回商品列表' })).toBeTruthy();
  });

  test('查询条件保持参考页三项、规则筛选留在工具栏，提交查询后才筛选结果', /* filterLayoutCase 防止操作按钮和高级规则筛选挤入参考查询行，并验证回车提交与查询一致。 */ async () => {
    // otherItem 是不匹配测试搜索词的商品，用于确认查询草稿不会提前过滤。
    const otherItem: Item = { ...itemFixture, item_id: 'other-item', id: 'other-item', item_title: '电影票' };
    itemListMocks.getItems.mockResolvedValue([itemFixture, otherItem]);
    render(<ItemList onConfigureDelivery={vi.fn()} />);
    await screen.findByRole('checkbox', { name: '选择商品：电影票' });
    // searchForm 按参考页只承载店铺、搜索词和查询按钮。
    const searchForm = screen.getByRole('search', { name: '商品筛选' });
    expect(within(searchForm).getByRole('combobox', { name: '当前账号' })).toBeTruthy();
    expect(within(searchForm).queryByRole('combobox', { name: '按交易自动化规则筛选商品列表' })).toBeNull();
    /** queryButton 是参考查询行中的唯一提交动作。 */
    const queryButton = within(searchForm).getByRole('button', { name: '查询' });
    expect(queryButton).toBeTruthy();
    /** ruleGroup 是工具栏中保留原有规则筛选能力的独立分组。 */
    const ruleGroup = screen.getByRole('group', { name: '商品规则筛选' });
    expect(within(ruleGroup).getByRole('combobox', { name: '按交易自动化规则筛选商品列表' })).toBeTruthy();
    expect(searchForm.contains(ruleGroup)).toBe(false);
    expect(within(searchForm).queryByRole('button', { name: '同步商品' })).toBeNull();
    // operationGroup 是“更多操作”菜单中承载同步、发布、批量等按钮的独立工具区。
    const operationGroup = openItemTools();
    expect(within(operationGroup).getByRole('menuitem', { name: '同步商品' })).toBeTruthy();
    expect(within(operationGroup).queryByRole('combobox', { name: '按交易自动化规则筛选商品列表' })).toBeNull();
    expect(searchForm.contains(operationGroup)).toBe(false);
    fireEvent.change(within(searchForm).getByRole('searchbox'), { target: { value: '  电影票  ' } });
    expect(screen.getByRole('checkbox', { name: '选择商品：测试商品' })).toBeTruthy();
    fireEvent.submit(searchForm);
    expect(screen.queryByRole('checkbox', { name: '选择商品：测试商品' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: '选择商品：电影票' })).toBeTruthy();
    expect(itemListMocks.getItems).toHaveBeenCalledTimes(1);
  });

  test('发货标签只匹配付款发货规则并在切换筛选后清空勾选', /* deliveryTabCase 防止评价规则被误认为付款发货，且隐藏商品不保留操作选择。 */ async () => {
    // reviewRule 是仅配置评价赠品的商品规则，不提供付款后发货能力。
    const reviewRule: ShippingRule = {
      id: 'review-only', name: '评价赠品', trigger_type: 'buyer_reviewed', item_keyword: '',
      cookie_id: itemFixture.cookie_id, item_id: itemFixture.item_id, card_group_id: 0,
      priority: 0, enabled: true, actions: [], variants: [],
    };
    itemListMocks.getShippingRules.mockResolvedValue([reviewRule]);
    render(<ItemList onConfigureDelivery={vi.fn()} />);
    await screen.findByRole('checkbox', { name: '选择商品：测试商品' });
    fireEvent.click(screen.getByRole('checkbox', { name: '选择商品：测试商品' }));
    expect(screen.getByText(/已选\s*1\s*件/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '已配置发货' }));
    expect(screen.queryByRole('checkbox', { name: '选择商品：测试商品' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '未配置发货' }));
    expect((screen.getByRole('checkbox', { name: '选择商品：测试商品' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole('button', { name: '批量设置' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '批量上下架' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: '出售中的商品' }));
    expect(screen.queryByRole('checkbox', { name: '选择商品：测试商品' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '全部商品' }));
    expect(screen.getByRole('checkbox', { name: '选择商品：测试商品' })).toBeTruthy();
  });

  test('商品管理只保留一个账号选择且能够记住上次选择', /* singleAccountPickerCase 验证单一入口与刷新恢复。 */ async () => {
    render(<ItemList onConfigureDelivery={vi.fn()} />);
    await waitFor(/* waitAccountPicker 等待账号下拉框加载。 */ () => expect(screen.getByRole('combobox', { name: '当前账号' })).toBeTruthy());
    expect(screen.queryByRole('combobox', { name: '按账号筛选商品列表' })).toBeNull();
    expect(within(openItemTools()).getByRole('menuitem', { name: '同步商品' }).hasAttribute('disabled')).toBe(true);
    expect(within(screen.getByRole('menu', { name: '商品列表工具' })).getByRole('menuitem', { name: '发布商品' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    fireEvent.change(screen.getByRole('combobox', { name: '当前账号' }), { target: { value: 'account-1' } });
    await waitFor(/* waitPreferenceSaved 等待浏览器记忆保存。 */ () => expect(window.localStorage.getItem('ydisks.items.selected_account')).toBe('account-1'));
    expect(within(openItemTools()).getByRole('menuitem', { name: '同步商品' }).hasAttribute('disabled')).toBe(false);
    cleanup();
    render(<ItemList onConfigureDelivery={vi.fn()} />);
    await waitFor(/* waitRememberedAccount 等待记忆账号回显。 */ () => expect((screen.getByRole('combobox', { name: '当前账号' }) as HTMLSelectElement).value).toBe('account-1'));
  });

  test('已删除的记忆账号回退到全部账号并阻止发布', /* invalidAccountFallbackCase 验证失效账号安全回退。 */ async () => {
    window.localStorage.setItem('ydisks.items.selected_account', 'deleted-account');
    render(<ItemList onConfigureDelivery={vi.fn()} />);
    await waitFor(/* waitInvalidation 等待加载后清除旧账号。 */ () => expect(window.localStorage.getItem('ydisks.items.selected_account')).toBe(''));
    expect((screen.getByRole('combobox', { name: '当前账号' }) as HTMLSelectElement).value).toBe('');
    const tools = openItemTools();
    expect(within(tools).getByRole('menuitem', { name: '同步商品' }).hasAttribute('disabled')).toBe(true);
    expect(within(tools).getByRole('menuitem', { name: '发布商品' }).hasAttribute('disabled')).toBe(true);
  });

  test('切换唯一账号只筛选本地商品，不自动请求闲鱼同步', /* accountFilterFollowsSelectionCase 验证账号切换不产生平台操作。 */ async () => {
    // otherAccountItem 是与主账号不同的本地商品，用于验证列表筛选。
    const otherAccountItem: Item = { ...itemFixture, id: 'item-2', item_id: 'item-2', cookie_id: 'account-2', item_title: '第二账号商品' };
    itemListMocks.getAccountDetails.mockResolvedValue([
      { id: 'account-1', enabled: true, auto_confirm: false, remark: '测试账号' },
      { id: 'account-2', enabled: true, auto_confirm: false, remark: '备用账号' },
    ]);
    itemListMocks.getItems.mockResolvedValue([itemFixture, otherAccountItem]);
    render(<ItemList onConfigureDelivery={vi.fn()} />);
    await waitFor(/* waitBothAccountItems 等待初次显示两个账号的商品。 */ () => expect(screen.getByText('第二账号商品')).toBeTruthy());
    fireEvent.change(screen.getByRole('combobox', { name: '当前账号' }), { target: { value: 'account-1' } });
    expect(screen.getByText('测试商品')).toBeTruthy();
    expect(screen.queryByText('第二账号商品')).toBeNull();
    expect(itemListMocks.getItems).toHaveBeenCalledTimes(1);
    expect(within(openItemTools()).getByRole('menuitem', { name: '同步商品' }).hasAttribute('disabled')).toBe(false);
  });

  test('列表不逐商品读取，点击 Bot 入口后才加载并更新卡片状态', /* lazyItemAISettingsCase 验证按需请求边界。 */ async () => {
    render(<ItemList onConfigureDelivery={vi.fn()} itemAISettingsModal={ItemAISettingsModal} />);
    await waitFor(/* listLoadedAssertion 等待列表行和“更多”入口渲染。 */ () => expect(screen.getByRole('button', { name: '更多操作：测试商品' })).toBeTruthy());
    expect(itemListMocks.getItemAISettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '更多操作：测试商品' }));
    expect(screen.getByText('AI 客服（已启用）')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '配置商品 AI 客服：测试商品' }));
    await waitFor(/* detailRequestAssertion 等待用户点击后发起单商品配置读取。 */ () => expect(itemListMocks.getItemAISettings).toHaveBeenCalledWith('account-1', 'item-1', expect.objectContaining({ signal: expect.any(AbortSignal) })));
    await waitFor(/* contextLoadedAssertion 等待商品专属资料写入弹窗。 */ () => expect(screen.getByDisplayValue('材质：全新')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /强制停用/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(/* cardStateAssertion 等待 AI 配置弹窗关闭并回到列表。 */ () => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '更多操作：测试商品' }));
    expect(screen.getByText('AI 客服（已停用）')).toBeTruthy();
    expect(itemListMocks.getItems).toHaveBeenCalledTimes(1);
  });
});
