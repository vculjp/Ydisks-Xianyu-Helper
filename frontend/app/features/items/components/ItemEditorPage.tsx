import { ImagePlus } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Item } from '../models';
import './ItemEditorPage.css';

/** ItemEditorPageProps 由父级持有商品与草稿，并负责保存请求、成功关闭和失败反馈。 */
export interface ItemEditorPageProps {
  /** item 是当前已保存商品；未出现在 draft 中的字段从此回退。 */
  item: Item;
  /** draft 是父级持有的编辑表单；空字符串代表用户明确清空。 */
  draft: Partial<Item>;
  /** accountName 是所属账号的真实展示名，缺省文本时展示 item.cookie_id。 */
  accountName: string;
  /** busy 表示父级已有请求在途；期间禁止编辑、保存和返回。 */
  busy: boolean;
  /** onChange 接收合并后的草稿，仅四个支持保存的字段可由页面改写。 */
  onChange: (draft: Partial<Item>) => void;
  /** onBack 由父级决定返回列表及草稿处理。 */
  onBack: () => void;
  /** onSaveLocal 只触发既有本地保存；异步实现应返回 Promise 供页面等待。 */
  onSaveLocal: () => void | Promise<void>;
  /** onSaveRemote 触发既有闲鱼同步及其确认流程；异步实现应返回 Promise。 */
  onSaveRemote: () => void | Promise<void>;
}

/** SavedEditorDetail 只声明已保存扩展信息的可预览字段，未知结构不得当作默认业务值。 */
interface SavedEditorDetail {
  /** quantity 必须明确是非负整数或其字符串才作为库存显示。 */
  quantity?: unknown;
  /** location 只接受原始文本或包含省市区文本的地点对象。 */
  location?: unknown;
  /** postage_mode 是明确保存的运费模式，不由金额反推。 */
  postage_mode?: unknown;
  /** postage 是明确保存的运费金额，只有 fixed 模式才附加元单位。 */
  postage?: unknown;
}

/** savedDetail 只解码当前已保存详情；缺失、损坏或非对象 JSON 一律视为未获取。 */
function savedDetail(raw: string | undefined): SavedEditorDetail {
  try {
    /** parsed 仍需逐字段检查类型，解析成功不代表平台字段完整。 */
    const parsed: unknown = JSON.parse(raw || '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as SavedEditorDetail : {};
  } catch {
    return {};
  }
}

/** savedLocation 把已保存地点文本或明确的省市区转换为只读文案，不推断定位或默认城市。 */
function savedLocation(value: unknown): string {
  if (typeof value === 'string') return value.trim() || '未获取';
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '未获取';
  /** location 只读取发布地点模型中的已知文本键，不展示任意未知对象内容。 */
  const location = value as Record<string, unknown>;
  return [location.province, location.city, location.area, location.poi_name]
    .filter(/* part 仅保留服务端明确给出的非空地点文本。 */ (part): part is string => typeof part === 'string' && Boolean(part.trim()))
    .join(' / ') || '未获取';
}

/** savedQuantity 保留明确返回的零库存；缺失或非法库存不替换成一件。 */
function savedQuantity(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value;
  return '未获取';
}

/** savedPostage 只展示明确运费模式和金额，不将缺失邮费推断为包邮。 */
function savedPostage(detail: SavedEditorDetail): string {
  if (detail.postage_mode === 'free') return '包邮';
  if (detail.postage_mode === 'none') return '无需邮寄';
  if (detail.postage_mode === 'distance') return '按距离计费';
  if (detail.postage_mode !== 'fixed') return '未获取';
  if ((typeof detail.postage === 'string' && detail.postage.trim()) ||
    (typeof detail.postage === 'number' && Number.isFinite(detail.postage) && detail.postage >= 0)) {
    return `固定邮费：${detail.postage} 元`;
  }
  return '固定邮费（金额未获取）';
}

/** savedPostageMode 只返回平台明确保存的运费模式，缺失或未知文本不猜测默认值。 */
function savedPostageMode(detail: SavedEditorDetail): 'free' | 'fixed' | 'distance' | 'none' | undefined {
  return detail.postage_mode === 'free' || detail.postage_mode === 'fixed' ||
    detail.postage_mode === 'distance' || detail.postage_mode === 'none'
    ? detail.postage_mode
    : undefined;
}

/** categoryNames 只收录已由平台响应核实的类目 ID，避免猜测或伪造未知分类。 */
const categoryNames: Readonly<Record<string, string>> = {
  '201221406': '电影票',
  '50023914': '电子资料',
  '50025386': '电子资料',
  '50114004': '女士半身裙',
};

/** categoryDisplay 只转换已能确认的中文类目名，未知平台 ID 原样保留以便核对。 */
function categoryDisplay(value: string): string {
  /** normalized 是去掉首尾空白后的平台类目文本。 */
  const normalized = value.trim();
  return categoryNames[normalized] ?? normalized;
}

/** specChoiceOptions 是平台已明确支持的单双规格只读选项。 */
const specChoiceOptions = [
  { value: '单规格', label: '单规格' },
  { value: '多规格', label: '多规格' },
];

/** postageChoiceOptions 是平台已明确支持的运费模式只读选项。 */
const postageChoiceOptions = [
  { value: 'free', label: '包邮' },
  { value: 'fixed', label: '固定邮费' },
  { value: 'distance', label: '按距离计费' },
  { value: 'none', label: '无需邮寄' },
];

/** ReadOnlyEditorFieldProps 定义不能由当前编辑接口保存的字段及可访问的原因说明。 */
interface ReadOnlyEditorFieldProps {
  /** id 关联字段标签与原因，不与其他编辑器实例冲突。 */
  id: string;
  /** label 是参考布局中的真实字段名。 */
  label: string;
  /** value 是已确认的保存值或未获取。 */
  value: string;
  /** reason 解释为何该字段只能查看。 */
  reason: string;
  /** disabled 在任一保存请求在途时阻止字段交互。 */
  disabled: boolean;
  /** required 控制参考布局中的必填星号，不改变字段的只读语义。 */
  required?: boolean;
  /** selectLike 只改变参考页中的下拉外观，不改变只读输入框语义。 */
  selectLike?: boolean;
}

/** ReadOnlyEditorField 使用同一标签列布局展示真实信息和只读原因，不产生草稿更新。 */
function ReadOnlyEditorField(props: ReadOnlyEditorFieldProps) {
  return (
    <div className="editor-line">
      <label className={`editor-label${props.required ? ' is-required' : ''}`} htmlFor={props.id}>{props.label}</label>
      <div className="editor-control">
        <div className={props.selectLike ? 'editor-readonly-select' : undefined}>
          <input id={props.id} value={props.value} readOnly disabled={props.disabled} aria-describedby={`${props.id}-help`} />
          {props.selectLike && <span className="editor-select-arrow" aria-hidden="true">⌄</span>}
        </div>
        <p className="editor-help is-visually-hidden" id={`${props.id}-help`}>{props.reason}</p>
      </div>
    </div>
  );
}

/** ReadOnlyChoiceOption 是只读单选组中的一个真实业务选项。 */
interface ReadOnlyChoiceOption {
  /** value 是提交给原生单选输入的稳定业务值。 */
  value: string;
  /** label 是参考页展示的中文选项名。 */
  label: string;
  /** detail 是可选的已保存金额说明。 */
  detail?: string;
}

/** ReadOnlyChoiceFieldProps 描述只用于展示的参考页单选组。 */
interface ReadOnlyChoiceFieldProps {
  /** id 是本组单选与说明的唯一标识前缀。 */
  id: string;
  /** label 是参考布局中的字段名。 */
  label: string;
  /** selected 是平台明确保存的选项；未知时不选中任何项。 */
  selected?: string;
  /** options 是保留真实业务含义的固定选项。 */
  options: ReadOnlyChoiceOption[];
  /** reason 解释该组为何只读。 */
  reason: string;
  /** disabled 在父级请求或当前保存回调期间禁用输入。 */
  disabled: boolean;
}

/** ReadOnlyChoiceField 使用原生单选组呈现参考页控件，任何点击都不会写入草稿。 */
function ReadOnlyChoiceField(props: ReadOnlyChoiceFieldProps) {
  return (
    <div className="editor-line">
      <span className="editor-label" id={props.id}>{props.label}</span>
      <div className="editor-control is-choice">
        <div className="editor-choice-group" role="radiogroup" aria-labelledby={props.id} aria-describedby={`${props.id}-help`}>
          {props.options.map(/* option 是平台支持的真实只读选项。 */ option => (
            <label key={option.value} className="editor-choice">
              <input
                type="radio"
                name={props.id}
                value={option.value}
                checked={props.selected === option.value}
                disabled={props.disabled}
                readOnly
                onClick={/* 只读单选不改变平台值；阻止原生 radio 的选中动作。 */ event => event.preventDefault()}
                onKeyDown={/* 方向键同样不能绕过只读单选组改变展示值。 */ event => {
                  if (event.key.startsWith('Arrow')) event.preventDefault();
                }}
                aria-label={`${option.label}${option.detail ? ` ${option.detail}` : ''}`}
              />
              <span>{option.label}</span>
              {option.detail && <small>{option.detail}</small>}
            </label>
          ))}
        </div>
        <p className="editor-help is-visually-hidden" id={`${props.id}-help`}>{props.reason}</p>
      </div>
    </div>
  );
}

/** validRemotePrice 与既有远端金额边界一致；只校验临时副本，不改写草稿中的货币符号。 */
function validRemotePrice(raw: string): boolean {
  /** normalized 仅供校验，保留页面和回调里的原价格文本不变。 */
  const normalized = raw.trim().replace(/^¥/, '').replace(/^￥/, '').trim();
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(normalized)) return false;
  /** yuan/fraction 分别是十进制整数元与小数分；BigInt 避免合法大金额的浮点精度损失。 */
  const [yuan, fraction = ''] = normalized.split('.');
  return BigInt(yuan) >= 0n && BigInt(yuan) <= 9000000000000000n &&
    (BigInt(yuan) > 0n || /[1-9]/.test(fraction));
}

/** RemoteErrors 对应仅远端支持编辑的三个字段；本地兼容保存不增加历史限制。 */
interface RemoteErrors {
  /** title 是用户实际清空远端标题时的提示。 */
  title?: string;
  /** description 是用户实际清空远端描述时的提示。 */
  description?: string;
  /** price 是用户修改售价后未满足既有远端金额格式时的提示。 */
  price?: string;
}

/** ItemEditorForm 的瞬态提交状态归当前商品所有；商品切换时由外层 key 隔离旧回调。 */
function ItemEditorForm(props: ItemEditorPageProps) {
  /** fieldId 是本实例标签、说明与 tabpanel 共用的唯一前缀。 */
  const fieldId = useId();
  /** internalSaving/setInternalSaving 只控制回调等待期间的 UI，不复制父级的商品或草稿。 */
  const [internalSaving, setInternalSaving] = useState(false);
  /** savingRef 在 React 渲染前同步拦截双击、键盘提交与两个保存入口的交叉调用。 */
  const savingRef = useRef(false);
  /** saveError/setSaveError 展示回调直接抛出的错误；草稿继续完整归父级所有。 */
  const [saveError, setSaveError] = useState('');
  /** remoteErrors/setRemoteErrors 只记录当前提交的字段错误，不复制草稿或服务端状态。 */
  const [remoteErrors, setRemoteErrors] = useState<RemoteErrors>({});
  /** locked 同时覆盖父级请求与组件等待回调，两个来源都结束后才能继续操作。 */
  const locked = props.busy || internalSaving;
  /** title 保留存量长标题和用户显式清空，不套用参考页面的 30 字上限。 */
  const title = props.draft.item_title ?? props.item.item_title ?? '';
  /** description 是完整的真实商品描述，不从标题生成占位正文。 */
  const description = props.draft.item_description ?? props.item.item_description ?? '';
  /** category 是可在本地保存的分类文本，不冒充平台类目选择接口。 */
  const category = categoryDisplay(props.draft.item_category ?? props.item.item_category ?? '');
  /** price 保留原始价格文本，避免渲染时四舍五入或填入默认售价。 */
  const price = props.draft.item_price ?? props.item.item_price ?? '';
  /** detail 是原商品扩展信息的只读预览，不能使用草稿里的不可保存字段。 */
  const detail = savedDetail(props.item.item_detail);
  /** specMode 只展示已提供的规格标记，缺失时不默认单规格。 */
  const specMode = props.item.is_multi_spec === true || props.item.is_multi_spec === 1 ? '多规格'
    : props.item.is_multi_spec === false || props.item.is_multi_spec === 0 ? '单规格' : '未获取';
  /** postageMode 只使用平台明确保存的运费模式。 */
  const postageMode = savedPostageMode(detail);
  /** postageOptions 只在固定邮费时附加真实金额文案，其余选项保持原样。 */
  const postageOptions = postageChoiceOptions.map(/* option 是固定运费模式之一。 */ option =>
    option.value === 'fixed' ? { ...option, detail: postageMode === 'fixed' ? savedPostage(detail) : undefined } : option,
  );

  /** 页面等待期间同步浏览器离开保护；卸载或请求完成时释放监听，不取消父级持有的请求。 */
  useEffect(/* locked 改变时更新离开保护，避免无请求时也阻止正常导航。 */ () => {
    if (!locked) return;
    /** event 是关闭标签或刷新时的导航事件，由浏览器决定是否呈现离开提示。 */
    const protectRequest = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectRequest);
    return /* 请求完成或组件卸载时移除属于本表单的导航监听。 */ () => window.removeEventListener('beforeunload', protectRequest);
  }, [locked]);

  /** changeField 接收四个真实可保存字段之一及原始文本，在途时拒绝草稿变更。 */
  function changeField(field: 'item_title' | 'item_description' | 'item_category' | 'item_price', value: string) {
    if (props.busy || savingRef.current) return;
    setRemoteErrors({});
    props.onChange({ ...props.draft, [field]: value });
  }

  /** save 等待父级本地或闲鱼回调，失败仅显示原因并保留父级草稿，最终总是释放本次锁。 */
  async function save(target: 'local' | 'remote') {
    if (props.busy || savingRef.current) return;
    /** errors 只校验与原值相比真正发生变化的远端字段；历史空值不阻断无关修改。 */
    const errors: RemoteErrors = {};
    if (target === 'remote') {
      if (title.trim() !== (props.item.item_title || '').trim() && !title.trim()) errors.title = '宝贝标题不能为空。';
      if (description.trim() !== (props.item.item_description || '').trim() && !description.trim()) errors.description = '宝贝描述不能为空。';
      if (price.trim() !== (props.item.item_price || '').trim() && !validRemotePrice(price)) errors.price = '售价需大于 0 且最多两位小数，可带 ¥ 或 ￥。';
    }
    setRemoteErrors(errors);
    if (errors.title || errors.description || errors.price) return;
    savingRef.current = true;
    setInternalSaving(true);
    setSaveError('');
    try {
      await (target === 'local' ? props.onSaveLocal() : props.onSaveRemote());
    } catch (/* error 是父级回调未自行处理的保存错误，不在此自动重试平台操作。 */ error: unknown) {
      setSaveError(error instanceof Error ? error.message || '保存失败，请重试。' : '保存失败，请重试。');
    } finally {
      savingRef.current = false;
      setInternalSaving(false);
    }
  }

  return (
    <section className="item-editor-page" aria-label="商品编辑页" aria-busy={locked}>
      <header className="editor-header">
        <button type="button" className="editor-back" aria-label="返回商品列表" disabled={locked} onClick={/* 请求未结束时拒绝返回；其余导航逻辑交给父级。 */ () => {
          if (!props.busy && !savingRef.current) props.onBack();
        }}>
          <span aria-hidden="true">‹</span>返回
        </button>
        <h1>编辑商品</h1>
      </header>
      <div className="editor-card">
        <div className="editor-tabs" role="tablist" aria-label="商品编辑">
          <button type="button" role="tab" id={`${fieldId}-tab`} aria-controls={`${fieldId}-panel`} aria-selected="true">商品信息</button>
        </div>
        <form
          id={`${fieldId}-panel`}
          className="product-editor-form"
          role="tabpanel"
          aria-labelledby={`${fieldId}-tab`}
          noValidate
          onSubmit={/* event 来自按钮或键盘提交；默认动作只保存本地，不隐式同步真实商品。 */ event => {
            event.preventDefault();
            void save('local');
          }}
        >
          <div className="editor-line">
            <label className="editor-label is-required" htmlFor={`${fieldId}-title`}>宝贝标题</label>
            <div className="editor-control">
              <div className="editor-count-wrap">
                <input
                  id={`${fieldId}-title`}
                  value={title}
                  placeholder="请输入宝贝标题，最多30个汉字"
                  disabled={locked}
                  aria-invalid={Boolean(remoteErrors.title)}
                  aria-describedby={`${fieldId}-title-count${remoteErrors.title ? ` ${fieldId}-title-error` : ''}`}
                  onChange={/* event 携带用户输入的完整标题，其他草稿字段继续由父级持有。 */ event => changeField('item_title', event.target.value)}
                />
                <span className="editor-count" id={`${fieldId}-title-count`}>
                  <span>{Array.from(title).length}</span>
                  <span className="editor-count-limit">/30</span>
                </span>
              </div>
              {remoteErrors.title && <p className="editor-error" id={`${fieldId}-title-error`}>{remoteErrors.title}</p>}
            </div>
          </div>
          <div className="editor-line">
            <label className="editor-label is-required" htmlFor={`${fieldId}-description`}>宝贝描述</label>
            <div className="editor-control">
              <div className="editor-count-wrap editor-multiline">
                <textarea
                  id={`${fieldId}-description`}
                  value={description}
                  placeholder="请输入宝贝描述"
                  disabled={locked}
                  aria-invalid={Boolean(remoteErrors.description)}
                  aria-describedby={remoteErrors.description ? `${fieldId}-description-error` : undefined}
                  onChange={/* event 携带完整描述，保留换行与用户输入的空白。 */ event => changeField('item_description', event.target.value)}
                />
                <span className="editor-count">
                  <span>{Array.from(description).length}</span>
                  <span className="editor-count-limit">/5000</span>
                </span>
              </div>
              {remoteErrors.description && <p className="editor-error" id={`${fieldId}-description-error`}>{remoteErrors.description}</p>}
            </div>
          </div>
          <div className="editor-line">
            <span className="editor-label is-required" id={`${fieldId}-images`}>宝贝图</span>
            <div className="editor-control" role="group" aria-labelledby={`${fieldId}-images`}>
              <div className="editor-gallery">
                {props.item.item_image ? (
                  <span className="editor-picture-wrap">
                    <a className="editor-picture" href={props.item.item_image} target="_blank" rel="noopener noreferrer" aria-label="查看商品原图">
                      <img src={props.item.item_image} alt="商品主图预览" />
                    </a>
                    <button type="button" className="editor-picture-remove" disabled title="当前编辑接口不支持删除图片" aria-label="移除商品图（当前接口不支持）">×</button>
                  </span>
                ) : <span className="editor-picture editor-empty-image">暂无商品主图</span>}
                <span className="editor-picture-add" aria-hidden="true"><ImagePlus /></span>
              </div>
              <p className="editor-help">默认首张图为主图，最多上传10张；当前编辑接口仅支持预览，不能排序或上传。</p>
            </div>
          </div>
          <div className="editor-line">
            <label className="editor-label is-required" htmlFor={`${fieldId}-category`}>商品分类</label>
            <div className="editor-control">
              <div className="editor-select-wrap">
                <input
                  id={`${fieldId}-category`}
                  value={category}
                  placeholder="请选择商品分类"
                  disabled={locked}
                  aria-describedby={`${fieldId}-category-help`}
                  onChange={/* event 更新本地分类文本；不发起类目推荐或其他平台请求。 */ event => changeField('item_category', event.target.value)}
                />
                <span className="editor-select-arrow" aria-hidden="true">⌄</span>
              </div>
              <p className="editor-help is-visually-hidden" id={`${fieldId}-category-help`}>仅保存本地；闲鱼编辑接口不支持修改分类。</p>
            </div>
          </div>
          <div className="editor-line">
            <span className="editor-label">分类属性</span>
            <div className="editor-control is-wide">
              <div className="editor-attributes" role="group" aria-label="分类属性（只读）">
                <label><span>资料类型</span><select disabled><option>未获取</option></select></label>
                <label><span>交付方式</span><select disabled><option>未获取</option></select></label>
                <label><span>适用平台</span><select disabled><option>未获取</option></select></label>
              </div>
              <p className="editor-help is-visually-hidden">当前接口未返回分类属性，仅作只读展示。</p>
            </div>
          </div>
          <ReadOnlyEditorField selectLike required id={`${fieldId}-location`} label="定位城市" value={savedLocation(detail.location)} reason="当前编辑接口不支持修改定位；未返回的定位显示为未获取。" disabled={locked} />
          <div className="editor-line">
            <label className="editor-label" htmlFor={`${fieldId}-account`}>所属店铺</label>
            <div className="editor-control">
              <input id={`${fieldId}-account`} value={props.accountName || props.item.cookie_id} readOnly disabled={locked} aria-describedby={`${fieldId}-account-help`} />
              <p className="editor-help is-visually-hidden" id={`${fieldId}-account-help`}>商品归属账号不可通过编辑商品变更。</p>
            </div>
          </div>
          <ReadOnlyChoiceField
            id={`${fieldId}-specs`}
            label="商品规格"
            selected={specMode === '未获取' ? undefined : specMode}
            options={specChoiceOptions}
            reason="当前编辑接口不支持修改商品规格；仅展示已保存的规格标记。"
            disabled={locked}
          />
          <div className="editor-line">
            <label className="editor-label is-required" htmlFor={`${fieldId}-price`}>售价</label>
            <div className="editor-control">
              <div className="editor-unit">
                <input
                  id={`${fieldId}-price`}
                  inputMode="decimal"
                  value={price}
                  disabled={locked}
                  aria-invalid={Boolean(remoteErrors.price)}
                  aria-describedby={`${fieldId}-price-unit${remoteErrors.price ? ` ${fieldId}-price-error` : ''}`}
                  onChange={/* event 更新原始售价文本，校验时再按真实动作判断是否可提交。 */ event => changeField('item_price', event.target.value)}
                />
                <span id={`${fieldId}-price-unit`}>元</span>
              </div>
              {remoteErrors.price && <p className="editor-error" id={`${fieldId}-price-error`}>{remoteErrors.price}</p>}
            </div>
          </div>
          <div className="editor-line">
            <label className="editor-label is-required" htmlFor={`${fieldId}-quantity`}>库存</label>
            <div className="editor-control">
              <div className="editor-unit">
                <input
                  id={`${fieldId}-quantity`}
                  value={savedQuantity(detail.quantity)}
                  readOnly
                  disabled={locked}
                  aria-describedby={`${fieldId}-quantity-help`}
                />
                <span>件</span>
                <span className="titTip">库存功能仅限鱼小铺使用</span>
              </div>
              <p className="editor-help is-visually-hidden" id={`${fieldId}-quantity-help`}>当前编辑接口不支持修改库存。</p>
            </div>
          </div>
          <ReadOnlyChoiceField
            id={`${fieldId}-postage`}
            label="运费设置"
            selected={postageMode}
            options={postageOptions}
            reason="当前编辑接口不支持修改运费；未返回的运费显示为未获取。"
            disabled={locked}
          />
          <div className="editor-line">
            <span className="editor-label" aria-hidden="true" />
            <div className="editor-control">
              <label className="editor-choice editor-checkbox-line">
                <input type="checkbox" disabled={locked} readOnly aria-describedby={`${fieldId}-relist-help`} />
                <span>开启售罄自动上架</span>
              </label>
              <p className="editor-help is-visually-hidden" id={`${fieldId}-relist-help`}>当前后端未提供售罄自动上架能力，此字段仅按参考页展示。</p>
            </div>
          </div>
          <div className="editor-line editor-submit-line">
            <span />
            <div className="editor-control">
              <div className="editor-actions">
                <button type="submit" aria-label="仅保存本地" className="editor-button editor-primary" disabled={locked}>保存</button>
                <button type="button" aria-label="同步修改到闲鱼" className="editor-button editor-sync-link" disabled={locked} onClick={/* 用户明确选择远端动作后才委托父级确认与同步。 */ () => void save('remote')}>同步到闲鱼</button>
              </div>
              <p className="editor-help editor-action-help is-visually-hidden">「仅保存本地」不会修改闲鱼；「同步修改到闲鱼」仅同步实际改动的标题、描述和售价，分类须另行保存本地。</p>
              {locked && <p className="editor-help" role="status">正在处理，请等待完成后再返回。</p>}
              {saveError && <p className="editor-error" role="alert">{saveError}</p>}
              {(remoteErrors.title || remoteErrors.description || remoteErrors.price) && <p className="editor-error" role="alert">请检查表单：{[remoteErrors.title, remoteErrors.description, remoteErrors.price].filter(Boolean).join(' ')}</p>}
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}

/** ItemEditorPage 的 props 是唯一输入边界，按账号与商品隔离瞬态 UI，旧请求不能覆盖新商品反馈。 */
export function ItemEditorPage(props: ItemEditorPageProps) {
  return <ItemEditorForm key={`${props.item.cookie_id}:${props.item.item_id}`} {...props} />;
}

export default ItemEditorPage;
