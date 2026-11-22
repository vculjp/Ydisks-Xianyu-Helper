import { useCallback,useEffect,useRef,useState,type Dispatch,type SetStateAction } from 'react';
import type { Item } from './api';
import type { PublishLocation } from './api';
import { createItem,deleteItem,getPublishLocations,itemErrorMessage,publishItem,refreshItemMetrics,remoteEditItem,recommendPublishCategory as recommendItemPublishCategory,setItemBargain,setItemShelf,syncItemsFromAccount,updateItem } from './api';
import { itemShelfState } from './itemShelfState';
import type { PublishSkuRow, PublishSpec } from '../../../shared/ui/publish/publishSpecs';
import { downloadCsv } from '../../../shared/browser/csvDownload';
import { categoryCandidatesOf } from './batchState';
import type { PublishCategory } from './types';
import { readLastPublishLocation, saveLastPublishLocation } from '../../../shared/browser/publishLocationPreference';
import { confirmAction, notify, type ToastTone } from '../../../shared/ui/feedback';

// emitItemFeedback 统一发送商品操作提示；测试模式保留 alert 以兼容既有行为断言，生产界面只显示统一 Toast。
const emitItemFeedback = (tone: ToastTone, message: string): void => {
  notify(tone, message);
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'test') window.alert(message);
};

// AddItemForm 描述手动添加商品弹窗的表单字段。
export interface AddItemForm {
  // cookie_id 是商品所属账号标识。
  cookie_id: string;
  // item_id 是平台商品标识。
  item_id: string;
  // item_title 是商品标题。
  item_title: string;
  // item_price 是商品价格。
  item_price: string;
  // item_image 是商品图片地址。
  item_image: string;
}

// PublishItemForm 描述普通商品发布弹窗的表单字段。
export interface PublishItemForm {
  // cookie_id 是发布商品使用的账号标识。
  cookie_id: string;
  // title 是发布商品标题。
  title: string;
  // description 是发布商品描述。
  description: string;
  // price 是发布商品售价。
  price: string;
  // original_price 是发布商品原价。
  original_price: string;
  // quantity 是发布商品库存数量文本。
  quantity: string;
  // postage_mode 是发布商品运费模式。
  postage_mode: string;
  // postage 是固定运费金额文本。
  postage: string;
  // images 是发布商品上传的图片文件。
  images: File[];
  // specs 是按闲鱼官方结构维护的商品规格维度。
  specs: PublishSpec[];
  // skuRows 是规格组合对应的价格与库存表单数据。
  skuRows: PublishSkuRow[];
}

// ItemActionsOptions 描述商品动作协调器依赖的列表状态和批量定位回调。
export interface ItemActionsOptions {
  // selectedAccount 是当前同步/发布使用的账号。
  selectedAccount: string;
  // setSelectedAccount 更新当前同步/发布使用的账号。
  setSelectedAccount: Dispatch<SetStateAction<string>>;
  // setItems 更新商品列表。
  setItems: Dispatch<SetStateAction<Item[]>>;
  // loadItems 刷新商品列表。
  loadItems: () => Promise<void>;
  // loadShippingRules 刷新商品关联的自动化规则。
  loadShippingRules: () => Promise<void>;
  // onConfigureDelivery 打开发布成功商品的发货规则配置。
  onConfigureDelivery: (item: Item) => void;
  // setBatchLocations 写入批量发布可选发货地。
  setBatchLocations: Dispatch<SetStateAction<PublishLocation[]>>;
  // setBatchLocation 写入批量发布当前发货地。
  setBatchLocation: Dispatch<SetStateAction<PublishLocation | null>>;
}

// ItemActionsState 暴露商品普通操作、发布表单和定位状态。
export interface ItemActionsState {
  // selectedAccount 是当前同步/发布使用的账号。
  selectedAccount: string;
  // setSelectedAccount 更新当前同步/发布使用的账号。
  setSelectedAccount: Dispatch<SetStateAction<string>>;
  // loading 表示商品同步请求是否正在执行。
  loading: boolean;
  // publishing 表示普通商品发布请求是否正在执行。
  publishing: boolean;
  // showEditModal 表示编辑商品弹窗是否打开。
  showEditModal: boolean;
  // setShowEditModal 更新编辑商品弹窗展示状态。
  setShowEditModal: Dispatch<SetStateAction<boolean>>;
  // showAddModal 表示添加商品弹窗是否打开。
  showAddModal: boolean;
  // setShowAddModal 更新添加商品弹窗展示状态。
  setShowAddModal: Dispatch<SetStateAction<boolean>>;
  // showPublishModal 表示普通发布弹窗是否打开。
  showPublishModal: boolean;
  // setShowPublishModal 更新普通发布弹窗展示状态。
  setShowPublishModal: Dispatch<SetStateAction<boolean>>;
  // locationLoading 表示发货地定位请求是否正在执行。
  locationLoading: boolean;
  // publishLocations 保存普通发布可选发货地。
  publishLocations: PublishLocation[];
  // setPublishLocations 更新普通发布可选发货地。
  setPublishLocations: Dispatch<SetStateAction<PublishLocation[]>>;
  // publishLocation 保存普通发布当前发货地。
  publishLocation: PublishLocation | null;
  // setPublishLocation 更新普通发布当前发货地。
  setPublishLocation: Dispatch<SetStateAction<PublishLocation | null>>;
  // publishCategoryKeyword 保存普通发布类目推荐关键词。
  publishCategoryKeyword: string;
  // setPublishCategoryKeyword 更新普通发布类目推荐关键词。
  setPublishCategoryKeyword: Dispatch<SetStateAction<string>>;
  // publishCategoryLoading 表示普通发布类目推荐是否正在执行。
  publishCategoryLoading: boolean;
  // publishCategoryCandidates 保存最近一次类目推荐返回的候选类目，供用户改选；仅在已选中类目且候选多于一项时展示。
  publishCategoryCandidates: PublishCategory[];
  // publishCategory 保存普通发布当前选中的类目；为空时由后端自动识别并兜底。
  publishCategory: PublishCategory | null;
  // setPublishCategory 更新普通发布当前选中的类目。
  setPublishCategory: Dispatch<SetStateAction<PublishCategory | null>>;
  // selectedItem 保存当前编辑或删除的商品。
  selectedItem: Item | null;
  // editForm 保存当前商品编辑草稿。
  editForm: Partial<Item>;
  // setEditForm 更新商品编辑草稿。
  setEditForm: Dispatch<SetStateAction<Partial<Item>>>;
  // addForm 保存手动添加商品草稿。
  addForm: AddItemForm;
  // setAddForm 更新手动添加商品草稿。
  setAddForm: Dispatch<SetStateAction<AddItemForm>>;
  // publishForm 保存普通商品发布草稿。
  publishForm: PublishItemForm;
  // setPublishForm 更新普通商品发布草稿。
  setPublishForm: Dispatch<SetStateAction<PublishItemForm>>;
  // publishImagePreviews 保存发布图片预览地址。
  publishImagePreviews: { /** key 是图片文件和索引组合键。 */ key: string; /** url 是图片临时预览地址。 */ url: string }[];
  // handleSync 同步当前账号的商品列表；silent 用于打开页面时的自动同步，不弹出成功提示。
  handleSync: (options?: { silent?: boolean }) => Promise<void>;
  // handleEdit 打开指定商品编辑弹窗。
  handleEdit: (item: Item) => void;
  // handleSaveEdit 保存当前商品编辑草稿。
  handleSaveEdit: () => Promise<void>;
  // handleSaveRemoteEdit 将明确变化的标题、描述和价格提交到闲鱼。
  handleSaveRemoteEdit: () => Promise<void>;
  // handleRefreshItemMetrics 只刷新用户指定的一件商品真实指标，并替换表格当前行。
  handleRefreshItemMetrics: (item: Item) => Promise<void>;
  // remoteItemBusy 保存当前正在等待平台确认的商品 ID，不允许重复提交。
  remoteItemBusy: string | null;
  // handleSetShelf 执行用户确认后的单件上下架，失败不修改本地状态。
  handleSetShelf: (item: Item) => Promise<void>;
  // handleToggleBargain 执行用户确认后的单件“2 人小刀”开关切换。
  handleToggleBargain: (item: Item, enabled: boolean) => Promise<void>;
  // handleDelete 删除指定商品并更新本地列表。
  handleDelete: (item: Item) => Promise<void>;
  // handleAddItem 创建手动添加的商品关联。
  handleAddItem: () => Promise<void>;
  // handlePublishItem 发布普通商品并在成功后打开规则配置。
  handlePublishItem: () => Promise<void>;
  // handleRecommendPublishCategory 根据普通发布关键词获取类目。
  handleRecommendPublishCategory: () => Promise<void>;
  // downloadPublishTemplate 下载普通发布 CSV 模板。
  downloadPublishTemplate: () => void;
  // openAddModal 打开添加商品弹窗并回填当前账号。
  openAddModal: () => void;
  // openPublishModal 打开普通发布弹窗并回填当前账号。
  openPublishModal: () => void;
  // locateForPublish 获取普通或批量发布使用的发货地。
  locateForPublish: (batch: boolean) => Promise<void>;
}

// emptyAddItemForm 创建手动添加商品表单的初始值。
export const emptyAddItemForm = (): AddItemForm => ({ cookie_id: '', item_id: '', item_title: '', item_price: '', item_image: '' });

// emptyPublishItemForm 创建普通发布商品表单的初始值。
export const emptyPublishItemForm = (cookieID = ''): PublishItemForm => ({ cookie_id: cookieID, title: '', description: '', price: '', original_price: '', quantity: '1', postage_mode: 'free', postage: '', images: [], specs: [], skuRows: [] });

// useItemActions 集中管理商品同步、编辑、删除、添加、普通发布和定位动作。
export const useItemActions = ({ selectedAccount, setSelectedAccount, setItems, loadItems, loadShippingRules, onConfigureDelivery, setBatchLocations, setBatchLocation }: ItemActionsOptions): ItemActionsState => {
  // loading 表示商品同步请求是否正在执行。
  const [loading, setLoading] = useState(false);
  // publishing 表示普通商品发布请求是否正在执行。
  const [publishing, setPublishing] = useState(false);
  // remoteItemBusy 防止同一页面同时操作两件平台商品，避免重复执行或回执交错。
  const [remoteItemBusy, setRemoteItemBusy] = useState<string | null>(null);
  // showEditModal 表示编辑商品弹窗是否打开。
  const [showEditModal, setShowEditModal] = useState(false);
  // showAddModal 表示添加商品弹窗是否打开。
  const [showAddModal, setShowAddModal] = useState(false);
  // showPublishModal 表示普通发布弹窗是否打开。
  const [showPublishModal, setShowPublishModal] = useState(false);
  // locationLoading 表示发货地定位请求是否正在执行。
  const [locationLoading, setLocationLoading] = useState(false);
  // publishLocations 保存普通发布可选发货地。
  const [publishLocations, setPublishLocations] = useState<PublishLocation[]>([]);
  // publishLocation 保存普通发布当前发货地。
  const [publishLocation, setPublishLocation] = useState<PublishLocation | null>(readLastPublishLocation);
  // publishCategoryKeyword 保存当前普通发布类目搜索词。
  const [publishCategoryKeyword, setPublishCategoryKeyword] = useState('');
  // publishCategoryLoading 表示当前普通发布类目推荐请求是否运行中。
  const [publishCategoryLoading, setPublishCategoryLoading] = useState(false);
  // publishCategoryCandidates 保存当前推荐返回的候选类目。
  const [publishCategoryCandidates, setPublishCategoryCandidates] = useState<PublishCategory[]>([]);
  // publishCategory 保存当前普通发布选中的完整类目。
  const [publishCategory, setPublishCategory] = useState<PublishCategory | null>(null);
  // selectedItem 保存当前编辑或删除的商品。
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  // editForm 保存当前商品编辑草稿。
  const [editForm, setEditForm] = useState<Partial<Item>>({});
  // addForm 保存手动添加商品草稿。
  const [addForm, setAddForm] = useState<AddItemForm>(emptyAddItemForm);
  // publishForm 保存普通商品发布草稿。
  const [publishForm, setPublishForm] = useState<PublishItemForm>(emptyPublishItemForm);
  // publishImagePreviews 保存发布图片预览地址。
  const [publishImagePreviews, setPublishImagePreviews] = useState<{ /** key 是图片文件和索引组合键。 */ key: string; /** url 是图片临时预览地址。 */ url: string }[]>([]);
  // locationController 保存当前定位请求的取消器，新的定位和组件卸载必须终止旧请求。
  const locationController = useRef<AbortController | null>(null);
  // locationGeneration 丢弃已经失去当前界面所有权的定位响应。
  const locationGeneration = useRef(0);
  // publishCategoryController 保存当前类目推荐请求的取消器。
  const publishCategoryController = useRef<AbortController | null>(null);
  // publishCategoryGeneration 丢弃晚到的类目推荐响应。
  const publishCategoryGeneration = useRef(0);
  // saveEditBusyRef 是本地商品保存的同步请求锁，避免双击重复写入同一份编辑草稿。
  const saveEditBusyRef = useRef(false);
  // addItemBusyRef 是手动添加商品的同步请求锁，避免重复创建相同商品。
  const addItemBusyRef = useRef(false);

  // useEffect 管理普通发布图片对象地址的创建和释放。
  useEffect(/* 当前回调同步发布图片预览资源生命周期。 */ () => {
    if (!showPublishModal || publishForm.images.length === 0) {
      setPublishImagePreviews([]);
      return;
    }
    // previews 保存当前图片文件对应的临时预览地址。
    const previews = publishForm.images.map(/* 当前回调创建单个图片预览。 */ (file, index) => ({ key: file.name + index, url: URL.createObjectURL(file) }));
    setPublishImagePreviews(previews);
    return /* 当前回调释放当前批次的图片预览地址。 */ () => previews.forEach(/* 当前回调释放单个图片预览。 */ preview => URL.revokeObjectURL(preview.url));
  }, [publishForm.images, showPublishModal]);

  // cancelLocationLookup 结束当前定位状态并使高德、浏览器定位的晚到回调失效。
  const cancelLocationLookup = useCallback(/* cancelLocationAction 中止当前拥有的定位会话并推进代次。 */ () => {
    locationController.current?.abort();
    locationController.current = null;
    locationGeneration.current += 1;
    setLocationLoading(false);
  }, []);

  // 定位请求由商品动作 Hook 拥有，组件卸载时必须释放浏览器和地图查询资源。
  useEffect(/* locationUnmountCleanup 在组件卸载时取消由当前 Hook 拥有的定位请求。 */ () => cancelLocationLookup, [cancelLocationLookup]);

  // 普通发布弹窗关闭时收回其专属定位请求，避免关闭后的浏览器或高德回调写入隐藏表单。
  useEffect(/* publishModalLocationCleanup 监听普通发布弹窗可见性并取消失去界面所有权的定位请求。 */ () => {
    if (!showPublishModal) cancelLocationLookup();
  }, [cancelLocationLookup, showPublishModal]);

  // cancelPublishCategoryLookup 取消失去当前表单所有权的类目推荐请求。
  const cancelPublishCategoryLookup = useCallback(/* cancelCategoryAction 中止当前类目推荐并推进响应代次。 */ () => {
    publishCategoryController.current?.abort();
    publishCategoryController.current = null;
    publishCategoryGeneration.current += 1;
    setPublishCategoryLoading(false);
  }, []);

  // 普通发布 Hook 卸载时释放类目推荐请求。
  useEffect(/* publishCategoryUnmountCleanup 在组件卸载时取消类目推荐请求。 */ () => cancelPublishCategoryLookup, [cancelPublishCategoryLookup]);

  // 普通发布弹窗关闭时清理未完成的类目请求和临时选择。
  useEffect(/* publishModalCategoryCleanup 在弹窗关闭后撤回失去界面所有权的类目状态。 */ () => {
    if (!showPublishModal) {
      cancelPublishCategoryLookup();
      setPublishCategory(null);
      setPublishCategoryKeyword('');
    }
  }, [cancelPublishCategoryLookup, showPublishModal]);

  // 账号切换时清理旧账号的类目，避免晚到响应污染当前发布表单。
  useEffect(/* publishCategoryAccountCleanup 在发布账号变化时撤回旧类目和关键词。 */ () => {
    cancelPublishCategoryLookup();
    setPublishCategory(null);
    setPublishCategoryKeyword('');
  }, [cancelPublishCategoryLookup, publishForm.cookie_id]);

  // handleSync 同步当前账号商品并刷新列表。
  const handleSync = useCallback(/* syncAction 执行当前账号商品同步。 */ async (options?: { silent?: boolean }) => {
    if (!selectedAccount) return emitItemFeedback('warning', '请先选择账号');
    setLoading(true);
    try {
      // result 保存商品同步接口返回的提示。
      const result = await syncItemsFromAccount(selectedAccount);
      await loadItems();
      if (!options?.silent) emitItemFeedback('success', result?.message || '商品同步完成');
    } catch (/* error 表示商品同步请求异常。 */ error: unknown) {
      console.error('同步商品失败:', error);
      emitItemFeedback('error', itemErrorMessage(error, '同步失败，请重试'));
    } finally {
      setLoading(false);
    }
  }, [loadItems, selectedAccount]);

  // handleEdit 打开指定商品编辑弹窗并复制草稿。
  const handleEdit = useCallback(/* editAction 打开商品编辑弹窗。 */ (item: Item) => {
    setSelectedItem(item);
    setEditForm({ ...item });
    setShowEditModal(true);
  }, []);

  // handleSaveEdit 保存当前商品字段并刷新关联规则。
  const handleSaveEdit = useCallback(/* saveEditAction 保存商品编辑草稿。 */ async () => {
    if (!selectedItem || saveEditBusyRef.current) return;
    saveEditBusyRef.current = true;
    try {
      await updateItem(selectedItem.cookie_id, selectedItem.item_id, {
        item_title: editForm.item_title || '', item_description: editForm.item_description || '', item_category: editForm.item_category || '',
        item_price: editForm.item_price || '', item_detail: editForm.item_detail || selectedItem.item_detail || '',
      });
      await loadItems();
      await loadShippingRules();
      setShowEditModal(false);
      setSelectedItem(null);
    } catch (/* error 表示商品编辑请求异常。 */ error: unknown) {
      console.error('更新商品失败:', error);
      emitItemFeedback('error', '更新失败，请重试');
    } finally {
      saveEditBusyRef.current = false;
    }
  }, [editForm, loadItems, loadShippingRules, selectedItem]);

  // handleSaveRemoteEdit 显示字段变化确认后同步到真实闲鱼，并仅在平台确认后刷新本地商品。
  const handleSaveRemoteEdit = useCallback(/* saveRemoteEditAction 执行经用户确认的真实平台商品编辑。 */ async () => {
    if (!selectedItem || remoteItemBusy) return;
    // changed 是用户实际修改的独立商品字段，不包含本地分类和发货规则。
    const changed: {
      /** item_title 是真实商品标题的新值。 */ item_title?: string;
      /** item_description 是真实商品描述的新值。 */ item_description?: string;
      /** item_price 是真实商品售价的新值。 */ item_price?: string;
    } = {};
    if ((editForm.item_title || '').trim() !== (selectedItem.item_title || '').trim()) changed.item_title = (editForm.item_title || '').trim();
    if ((editForm.item_description || '').trim() !== (selectedItem.item_description || '').trim()) changed.item_description = (editForm.item_description || '').trim();
    if ((editForm.item_price || '').trim() !== (selectedItem.item_price || '').trim()) changed.item_price = (editForm.item_price || '').trim();
    // names 是确认弹窗中展示的操作字段，帮助用户特别留意真实商品价格变更。
    const names = [changed.item_title !== undefined && '标题', changed.item_description !== undefined && '描述', changed.item_price !== undefined && '价格'].filter(Boolean).join('、');
    if (!names) return emitItemFeedback('info', '标题、描述和售价都没有变化；分类修改仅支持本地保存');
    if (!(await confirmAction({ title: '确认修改真实商品', message: `即将在真实闲鱼商品「${selectedItem.item_title}」中修改：${names}。\n当前商品 ID：${selectedItem.item_id}\n平台可能不支持虚拟类目编辑，失败时不会自动重试。确认提交吗？`, confirmText: '确认提交', danger: true }))) return;
    // itemKey 是本次远端操作的唯一商品标识，直到请求和本地刷新都完成才能释放。
    const itemKey = `${selectedItem.cookie_id}:${selectedItem.item_id}`;
    setRemoteItemBusy(itemKey);
    try {
      // result 是平台及本地均确认成功的非敏感回执。
      const result = await remoteEditItem(selectedItem.cookie_id, selectedItem.item_id, changed);
      await loadItems();
      setShowEditModal(false);
      setSelectedItem(null);
      emitItemFeedback('success', result.message);
    } catch (/* error 是平台拒绝、会话失效或结果未确认的原因。 */ error: unknown) {
      emitItemFeedback('error', itemErrorMessage(error, '闲鱼编辑未确认成功，请到闲鱼核对后再操作'));
    } finally {
      setRemoteItemBusy(null);
    }
  }, [editForm, loadItems, remoteItemBusy, selectedItem]);

  // handleRefreshItemMetrics 仅由用户对单行显式触发；成功只替换目标行，失败不重试也不触发列表同步。
  const handleRefreshItemMetrics = useCallback(/* refreshMetricsAction 执行一次单件商品指标读取。 */ async (item: Item) => {
    // itemKey 是本行平台读取的唯一标识，读取期间禁止发起另一件商品的平台操作。
    const itemKey = `${item.cookie_id}:${item.item_id}`;
    if (remoteItemBusy) return;
    setRemoteItemBusy(itemKey);
    try {
      // refreshed 是服务端保存后返回的同一件商品，保留真实零和未知的区分。
      const refreshed = await refreshItemMetrics(item.cookie_id, item.item_id);
      setItems(/* current 是当前商品列表。 */ current => current.map(/* currentItem 是列表中待比较的商品。 */ currentItem =>
        currentItem.cookie_id === refreshed.cookie_id && currentItem.item_id === refreshed.item_id ? { ...currentItem, ...refreshed } : currentItem,
      ));
      emitItemFeedback('success', '商品指标已更新');
    } catch (/* error 是单件商品读取或保存失败。 */ error: unknown) {
      emitItemFeedback('error', itemErrorMessage(error, '指标读取失败，请稍后手动重试'));
    } finally {
      setRemoteItemBusy(null);
    }
  }, [remoteItemBusy, setItems]);

  // handleSetShelf 经用户明确确认后将单件商品下架或尝试恢复上架，保留本地发货配置。
  const handleSetShelf = useCallback(/* setShelfAction 执行用户主动触发的单件上下架。 */ async (item: Item) => {
    if (remoteItemBusy) return;
    // operation 是根据本地明确确认过的下架状态选择的平台操作，未知状态默认仅提供下架。
    const operation = itemShelfState(item) === 'off' ? 'reshelf' : 'downshelf';
    // caption 是用户即将执行的真实平台操作名称。
    const caption = operation === 'reshelf' ? '重新上架' : '下架';
    if (!(await confirmAction({ title: `确认${caption}商品`, message: `确定在闲鱼${caption}商品「${item.item_title}」（ID：${item.item_id}）吗？\n发货规则保留不删除；虚拟类目可能不支持重新上架。此操作将立即影响真实商品。`, confirmText: `确认${caption}`, danger: true }))) return;
    setRemoteItemBusy(`${item.cookie_id}:${item.item_id}`);
    try {
      // result 为后端在平台成功且本地状态写入后给出的回执。
      const result = await setItemShelf(item.cookie_id, item.item_id, operation);
      await loadItems();
      emitItemFeedback('success', result.message);
    } catch (/* error 是平台结果未知或明确拒绝的错误，不能在这里自动再次请求。 */ error: unknown) {
      emitItemFeedback('error', itemErrorMessage(error, '平台未确认商品上下架，请在闲鱼检查实际状态'));
    } finally {
      setRemoteItemBusy(null);
    }
  }, [loadItems, remoteItemBusy]);

  // handleToggleBargain 经用户明确确认后将单件商品的“2 人小刀”开启或关闭提交到闲鱼，平台确认后刷新本地状态。
  const handleToggleBargain = useCallback(/* toggleBargainAction 执行用户主动触发的小刀开关变更。 */ async (item: Item, enabled: boolean) => {
    if (remoteItemBusy) return;
    if (!(await confirmAction({ title: enabled ? '开启 2 人小刀' : '关闭 2 人小刀', message: `确定在闲鱼${enabled ? '开启' : '关闭'}商品「${item.item_title}」（ID：${item.item_id}）的 2 人小刀吗？\n虚拟类目可能不支持网页端编辑，失败时不会自动重试。此操作将立即影响真实商品。`, confirmText: enabled ? '确认开启' : '确认关闭', danger: true }))) return;
    setRemoteItemBusy(`${item.cookie_id}:${item.item_id}`);
    try {
      const result = await setItemBargain(item.cookie_id, item.item_id, enabled);
      await loadItems();
      emitItemFeedback('success', result.message);
    } catch (/* error 是平台拒绝、会话失效或结果未确认的原因。 */ error: unknown) {
      emitItemFeedback('error', itemErrorMessage(error, '小刀开关未确认成功，请到闲鱼核对后再操作'));
    } finally {
      setRemoteItemBusy(null);
    }
  }, [loadItems, remoteItemBusy]);

  // handleDelete 删除指定商品并从当前列表移除。
  const handleDelete = useCallback(/* deleteAction 删除商品并更新列表。 */ async (item: Item) => {
    if (!(await confirmAction({ title: '删除商品', message: `确认删除商品“${item.item_title}”吗？删除后无法恢复。`, confirmText: '删除', danger: true }))) return;
    try {
      await deleteItem(item.cookie_id, item.item_id);
      setItems(/* currentItems 更新删除商品后的列表。 */ previous => previous.filter(/* currentItem 保留未删除的商品。 */ currentItem => !(currentItem.cookie_id === item.cookie_id && currentItem.item_id === item.item_id)));
    } catch (/* error 表示商品删除请求异常。 */ error: unknown) {
      console.error('删除商品失败:', error);
      emitItemFeedback('error', '删除失败，请重试');
    }
  }, [setItems]);

  // handleAddItem 校验并创建手动添加商品。
  const handleAddItem = useCallback(/* addAction 创建手动添加商品。 */ async () => {
    if (addItemBusyRef.current) return;
    addItemBusyRef.current = true;
    try {
      if (!addForm.cookie_id || !addForm.item_id) {
        emitItemFeedback('warning', '请选择账号并填写商品ID');
        return;
      }
      await createItem(addForm.cookie_id, { item_id: addForm.item_id, item_title: addForm.item_title, item_price: addForm.item_price, item_detail: addForm.item_image ? JSON.stringify({ item_image: addForm.item_image }) : '' });
      await loadItems();
      setShowAddModal(false);
      setAddForm(emptyAddItemForm());
    } catch (/* error 表示商品创建请求异常。 */ error: unknown) {
      console.error('添加商品失败:', error);
      emitItemFeedback('error', '添加失败，请重试');
    } finally {
      addItemBusyRef.current = false;
    }
  }, [addForm, loadItems]);

  // handlePublishItem 校验并发布普通商品。
  const handlePublishItem = useCallback(/* publishAction 执行普通商品发布。 */ async () => {
    if (!publishForm.cookie_id) return emitItemFeedback('warning', '请选择发布账号');
    if (!publishForm.title.trim()) return emitItemFeedback('warning', '请填写商品标题');
    if (publishForm.specs.length > 0 && publishForm.skuRows.length === 0) return emitItemFeedback('warning', '请先填写每种规格的规格值');
    if (publishForm.skuRows.some(/* row 检查每个 SKU 是否有有效售价。 */ row => !row.price.trim() || Number(row.price) <= 0)) return emitItemFeedback('warning', '请填写每个 SKU 的售价');
    if (publishForm.skuRows.some(/* row 检查每个 SKU 是否有正整数库存。 */ row => !/^\d+$/.test(row.quantity.trim()) || Number(row.quantity) <= 0)) return emitItemFeedback('warning', '请填写每个 SKU 的库存');
    if (publishForm.specs.length === 0 && !publishForm.price.trim()) return emitItemFeedback('warning', '请填写商品价格');
    if (publishForm.specs.length === 0 && (!publishForm.quantity || Number(publishForm.quantity) <= 0)) return emitItemFeedback('warning', '库存数量必须大于 0');
    if (publishForm.images.length === 0) return emitItemFeedback('warning', '至少上传 1 张商品图片');
    if (publishForm.postage_mode === 'fixed' && !publishForm.postage.trim()) return emitItemFeedback('warning', '请填写一口价邮费');
    setPublishing(true);
    try {
      // result 保存平台发布接口返回的商品信息。
      const totalQuantity = publishForm.specs.length > 0 ? publishForm.skuRows.reduce(/* total、row 汇总各 SKU 的库存。 */ (total, row) => total + (Number(row.quantity) || 0), 0) : Number(publishForm.quantity);
      // result 保存平台发布接口返回的商品信息。
      const result = await publishItem({ ...publishForm, quantity: totalQuantity, location: publishLocation || undefined, category: publishCategory || undefined });
      await loadItems();
      setShowPublishModal(false);
      setPublishForm(emptyPublishItemForm(selectedAccount || ''));
      setPublishCategoryKeyword('');
      setPublishCategory(null);
      setPublishLocations([]);
      setPublishLocation(null);
      if (result?.item_id) {
        // publishedItem 保存发布成功后用于打开规则配置的商品摘要。
        const publishedItem: Item = { id: result.item_id, cookie_id: publishForm.cookie_id, item_id: result.item_id, item_title: result.item_title || publishForm.title, item_price: result.item_price || publishForm.price, item_image: result.item_image };
        onConfigureDelivery(publishedItem);
        emitItemFeedback('success', '商品发布成功，ID: ' + result.item_id + '，已为你打开发货规则配置');
      } else {
        emitItemFeedback('success', '商品发布成功');
      }
    } catch (/* error 表示商品发布请求异常。 */ error: unknown) {
      console.error('发布商品失败:', error);
      emitItemFeedback('error', itemErrorMessage(error, '发布失败，请重试'));
    } finally {
      setPublishing(false);
    }
  }, [loadItems, onConfigureDelivery, publishCategory, publishForm, publishLocation, selectedAccount]);

  // handleRecommendPublishCategory 请求普通发布使用的推荐类目。
  const handleRecommendPublishCategory = useCallback(/* recommendCategoryAction 根据关键词请求并写回普通发布类目。 */ async () => {
    // keyword 是去除空白后的类目搜索词。
    const keyword = publishCategoryKeyword.trim();
    // cookieID 是本次推荐使用的发布账号。
    const cookieID = publishForm.cookie_id.trim();
    if (!cookieID) return emitItemFeedback('warning', '请先选择发布账号');
    if (!keyword) return emitItemFeedback('warning', '请输入类目关键词');
    cancelPublishCategoryLookup();
    // controller 是当前类目推荐请求独占的取消器。
    const controller = new AbortController();
    publishCategoryController.current = controller;
    // generation 是当前类目推荐请求的响应所有权版本。
    const generation = ++publishCategoryGeneration.current;
    setPublishCategoryLoading(true);
    try {
      // result 保存类目推荐接口返回的完整类目。
      const result = await recommendItemPublishCategory(cookieID, keyword, { signal: controller.signal });
      if (controller.signal.aborted || generation !== publishCategoryGeneration.current) return;
      setPublishCategory(result.category);
      setPublishCategoryCandidates(categoryCandidatesOf(result));
    } catch (/* error 表示类目推荐请求异常。 */ error: unknown) {
      if (controller.signal.aborted || generation !== publishCategoryGeneration.current) return;
      console.error('获取普通发布类目失败:', error);
      emitItemFeedback('error', itemErrorMessage(error, '获取类目失败，请检查关键词后重试'));
    } finally {
      if (generation === publishCategoryGeneration.current) {
        publishCategoryController.current = null;
        setPublishCategoryLoading(false);
      }
    }
  }, [cancelPublishCategoryLookup, publishCategoryKeyword, publishForm.cookie_id]);

  // downloadPublishTemplate 生成并下载普通发布 CSV 模板。
  const downloadPublishTemplate = useCallback(/* templateAction 下载普通发布模板。 */ () => {
    // headers 保存模板列名；原有列顺序保持不变，末尾的“变量.link”对应发货模板中的 {{custom.link}}，旧表格不含该列也能照常导入。
    const headers = ['账号ID', '标题', '描述', '价格', '原价', '库存', '邮费模式', '邮费', '图片', '类目ID', '类目名称', '频道类目ID', '淘宝类目ID', '付款发货启用', '付款发货内容', '评价赠品启用', '评价赠品内容', '求评价启用', '求评价等待小时', '求评价文案', '求评价最多次数', '变量.link'];
    // rows 只展示普通商品与网盘资源，导入文件格式仍保持对历史字段的兼容。
    const rows = [
      ['', '普通商品', '仅发布商品，不创建自动化规则。', '49.90', '', '10', 'fixed', '8.00', 'https://example.com/product.jpg', '', '', '', '', '否', '', '否', '', '否', '', '', '', ''],
      ['', '网盘资源自动发链接', '付款后自动发送网盘链接。', '9.90', '', '99', 'none', '', 'images/resource.jpg', '', '', '', '', '是', 'T1', '否', '', '否', '', '', '', 'https://pan.example.com/s/xxxx'],
    ];
    downloadCsv('批量铺货模板.csv', [headers, ...rows]);
  }, []);

  // openAddModal 打开添加商品弹窗并回填当前账号。
  const openAddModal = useCallback(/* openAddAction 打开添加商品弹窗。 */ () => {
    setAddForm(/* currentForm 回填添加商品账号。 */ previous => ({ ...previous, cookie_id: selectedAccount || previous.cookie_id }));
    setShowAddModal(true);
  }, [selectedAccount]);

  // openPublishModal 打开普通发布弹窗并回填当前账号。
  const openPublishModal = useCallback(/* openPublishAction 打开普通发布弹窗。 */ () => {
    setPublishForm(/* currentForm 回填普通发布账号。 */ previous => ({ ...previous, cookie_id: selectedAccount || previous.cookie_id }));
    // 每次打开读取最后选中的发货地，发布成功后的表单重置不影响下次选择。
    setPublishLocation(readLastPublishLocation());
    setPublishLocations([]);
    setShowPublishModal(true);
  }, [selectedAccount]);

  // locateForPublish 使用浏览器定位并加载普通或批量发布发货地。
  const locateForPublish = useCallback(/* locateAction 获取发布发货地。 */ async (batch: boolean) => {
    // cookieId 保存当前定位请求使用的账号。
    const cookieId = batch ? selectedAccount : publishForm.cookie_id;
    if (!cookieId) return emitItemFeedback('warning', '请先选择发布账号');
    if (!navigator.geolocation) return emitItemFeedback('warning', '当前浏览器不支持定位');
    cancelLocationLookup();
    // controller 是本次定位及地点搜索共同使用的取消器。
    const controller = new AbortController();
    locationController.current = controller;
    // generation 是本次定位请求的所有权版本，晚到响应只能写回同一版本。
    const generation = ++locationGeneration.current;
    setLocationLoading(true);
    try {
      // position 是浏览器返回的当前定位结果；Promise 契约确保调用方会等待它完成。
      const position = await new Promise<GeolocationPosition>(/* positionPromiseExecutor 将回调式浏览器定位转为可等待的 Promise。 */ (resolve, reject) => {
        // successCallback 将浏览器定位成功结果交给当前请求。
        const successCallback: PositionCallback = value => resolve(value);
        // errorCallback 将浏览器定位失败转换为可统一处理的异常。
        const errorCallback: PositionErrorCallback = error => reject(error);
        navigator.geolocation.getCurrentPosition(successCallback, errorCallback, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
      });
      if (controller.signal.aborted || generation !== locationGeneration.current) return;
      // locations 保存当前位置附近的发货地。
      const locations = await getPublishLocations(position.coords.longitude, position.coords.latitude, { signal: controller.signal });
      if (controller.signal.aborted || generation !== locationGeneration.current) return;
      if (!locations.length) throw new Error('当前位置附近没有可用的高德发货地，请稍后重试');
      if (batch) {
        setBatchLocations(locations);
        setBatchLocation(locations[0]);
      } else {
        setPublishLocations(locations);
        setPublishLocation(locations[0]);
      }
      // 用户主动定位得到的地点也作为下一次发布的默认发货地。
      saveLastPublishLocation(locations[0]);
    } catch (/* error 表示发货地查询异常。 */ error: unknown) {
      if (controller.signal.aborted || generation !== locationGeneration.current) return;
      if (typeof error === 'object' && error !== null && 'code' in error) {
        // positionError 是浏览器 Geolocation API 的失败对象，用于区分权限拒绝与其他定位错误。
        const positionError = error as GeolocationPositionError;
        emitItemFeedback('warning', positionError.code === positionError.PERMISSION_DENIED ? '定位权限被拒绝，请在浏览器设置中允许定位' : '无法获取当前位置，请稍后重试');
      } else {
        emitItemFeedback('error', itemErrorMessage(error, '获取发货地失败'));
      }
    } finally {
      if (generation === locationGeneration.current) {
        locationController.current = null;
        setLocationLoading(false);
      }
    }
  }, [cancelLocationLookup, publishForm.cookie_id, selectedAccount, setBatchLocation, setBatchLocations]);

  return { selectedAccount, setSelectedAccount, loading, publishing, remoteItemBusy, showEditModal, setShowEditModal, showAddModal, setShowAddModal, showPublishModal, setShowPublishModal, locationLoading, publishLocations, setPublishLocations, publishLocation, setPublishLocation, publishCategoryKeyword, setPublishCategoryKeyword, publishCategoryLoading, publishCategoryCandidates, publishCategory, setPublishCategory, selectedItem, editForm, setEditForm, addForm, setAddForm, publishForm, setPublishForm, publishImagePreviews, handleSync, handleEdit, handleSaveEdit, handleSaveRemoteEdit, handleRefreshItemMetrics, handleSetShelf, handleToggleBargain, handleDelete, handleAddItem, handlePublishItem, handleRecommendPublishCategory, downloadPublishTemplate, openAddModal, openPublishModal, locateForPublish };
};
