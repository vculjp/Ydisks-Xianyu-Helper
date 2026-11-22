import { Plus, Trash2 } from 'lucide-react';
import { actionsInScope, newAction, syncTemplateBindings, type SpecScope } from '../templateDraft';
import type { LibraryAction, LibraryActionGroup, LibraryAutomation, LibraryCardOption, LibraryDeliveryTemplateOption } from '../types';
import { SHOW_CARD_UI } from '../../../../shared/ui/featureVisibility';

/** TemplateAutomationEditorProps 描述自动化编辑器的输入与回调。 */
export interface TemplateAutomationEditorProps {
  /** automation 是当前自动化配置。 */
  automation: LibraryAutomation;
  /** scopes 是需要配置的规格范围；单规格只有一个。 */
  scopes: SpecScope[];
  /** cards 是可选卡密组。 */
  cards: LibraryCardOption[];
  /** deliveryTemplates 是可选发货模板。 */
  deliveryTemplates: LibraryDeliveryTemplateOption[];
  /** onChange 接收修改后的自动化配置。 */
  onChange: (next: LibraryAutomation) => void;
}

/** ActionRowProps 描述单个动作的编辑行。 */
interface ActionRowProps {
  /** action 是被编辑的动作。 */
  action: LibraryAction;
  /** deliveryTemplates 是可选发货模板。 */
  deliveryTemplates: LibraryDeliveryTemplateOption[];
  /** onChange 写回修改后的动作。 */
  onChange: (next: LibraryAction) => void;
  /** onRemove 删除该动作。 */
  onRemove: () => void;
}

/** inputClass 是本编辑器统一的输入框样式。 */
const inputClass = 'ios-input rounded-xl px-3 py-2 text-sm';

/** visibleDeliveryAction 仅展示无需卡密绑定的模板动作；旧动作仍保留在原数组中，不修改自动化执行计划。 */
export const visibleDeliveryAction = (action: LibraryAction, deliveryTemplates: LibraryDeliveryTemplateOption[]): boolean => {
  // 精简版始终不渲染发卡动作，即使旧数据库仍保留其执行配置。
  if (action.actionType !== 'send_template') return false;
  if (action.deliveryTemplateId === 0) return true;
  // 当前引用的模板若被删除或含库存变量，禁止在精简编辑器中以不完整表单误修改它。
  const template = deliveryTemplates.find(/* template 按持久化模板 ID 查找。 */ template => template.id === action.deliveryTemplateId);
  return !!template && template.keys.length === 0;
};

/** ActionRow 编辑一个发卡或发货模板动作。 */
const ActionRow = ({ action, deliveryTemplates, onChange, onRemove }: ActionRowProps) => {
  // template 是当前动作选中的发货模板选项。
  const template = deliveryTemplates.find(/* option 按主键匹配。 */ option => option.id === action.deliveryTemplateId);
  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">发货模板</span>
        <select aria-label="发货模板" className={inputClass} value={action.deliveryTemplateId} onChange={/* 选择发货模板并重建变量绑定。 */ event => onChange(syncTemplateBindings(action, deliveryTemplates.find(/* option 按主键匹配。 */ option => option.id === Number(event.target.value))))}>
          <option value={0}>选择发货模板</option>
          {deliveryTemplates.filter(/* option 只允许新增和编辑无库存绑定的发货模板。 */ option => option.keys.length === 0).map(/* option 渲染一个发货模板选项。 */ option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-500">延迟
          <input aria-label="延迟秒数" type="number" min={0} className={`${inputClass} w-20`} value={action.delaySeconds} onChange={/* 修改延迟秒数。 */ event => onChange({ ...action, delaySeconds: Math.max(0, Number(event.target.value)) })} />秒
        </label>
        <button type="button" aria-label="删除动作" className="ml-auto rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500" onClick={onRemove}><Trash2 className="h-4 w-4" /></button>
      </div>
      {action.actionType === 'send_template' && template && (
        <div className="space-y-2 pl-1">
          {Object.keys(action.customVariables).map(/* key 渲染一个自定义变量输入。 */ key => (
            <label key={key} className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">{`{{custom.${key}}}`}</code>
              <input aria-label={`自定义变量 ${key}`} className={`${inputClass} min-w-48 flex-1`} value={action.customVariables[key]} onChange={/* 修改自定义变量取值。 */ event => onChange({ ...action, customVariables: { ...action.customVariables, [key]: event.target.value } })} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

/** GroupEditorProps 描述一个动作组（付款发货或评价赠品）的编辑器。 */
interface GroupEditorProps extends Omit<TemplateAutomationEditorProps, 'automation' | 'onChange' | 'cards'> {
  /** title 是动作组标题。 */
  title: string;
  /** hint 是动作组说明。 */
  hint: string;
  /** group 是当前动作组。 */
  group: LibraryActionGroup;
  /** onChange 写回修改后的动作组。 */
  onChange: (next: LibraryActionGroup) => void;
}

/** GroupEditor 按规格范围分组编辑一个动作组。 */
const GroupEditor = ({ title, hint, group, scopes, deliveryTemplates, onChange }: GroupEditorProps) => (
  <section className="space-y-3 rounded-2xl bg-gray-50 border border-gray-100 p-4">
    <label className="flex items-center gap-2 text-sm font-extrabold text-gray-900">
      <input type="checkbox" checked={group.enabled} onChange={/* 切换该自动化的启用状态。 */ event => onChange({ ...group, enabled: event.target.checked })} />{title}
    </label>
    <p className="text-xs text-gray-500">{hint}</p>
    {group.enabled && scopes.map(/* scope 渲染一个规格范围的动作列表。 */ scope => (
      <div key={`${scope.specName}|${scope.specValue}`} className="space-y-2">
        {scopes.length > 1 || scope.specName ? <h5 className="text-xs font-black text-gray-700">规格：{scope.label}</h5> : null}
        {actionsInScope(group, scope).filter(/* entry 是原动作数组中的条目；隐藏库存动作但保持原索引用于安全保存。 */ entry => visibleDeliveryAction(entry.action, deliveryTemplates)).map(/* entry 渲染该范围内的一个动作。 */ ({ action, index }) => (
          <ActionRow key={index} action={action} deliveryTemplates={deliveryTemplates}
            onChange={/* 原位更新动作。 */ next => onChange({ ...group, actions: group.actions.map(/* item、i 定位被修改动作。 */ (item, i) => i === index ? next : item) })}
            onRemove={/* 删除动作。 */ () => onChange({ ...group, actions: group.actions.filter(/* _、i 过滤被删除动作。 */ (_, i) => i !== index) })} />
        ))}
        {!SHOW_CARD_UI && actionsInScope(group, scope).some(/* entry 判断有无需要原样保留的历史发货动作。 */ entry => !visibleDeliveryAction(entry.action, deliveryTemplates)) && (
          <p className="text-xs text-gray-500">部分历史发货配置在精简界面中不显示，保存其他设置不会将其删除。</p>
        )}
        <div className="flex gap-2">
          <button type="button" className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-gray-700 shadow-sm hover:bg-emerald-50" onClick={/* 追加发货模板动作。 */ () => onChange({ ...group, actions: [...group.actions, newAction('send_template', scope)] })}><Plus className="h-3.5 w-3.5" />发货模板</button>
        </div>
      </div>
    ))}
  </section>
);

/** TemplateAutomationEditor 编辑模板的付款发货、评价赠品和求评价；多规格时每个 SKU 单独配置。 */
export const TemplateAutomationEditor = ({ automation, scopes, deliveryTemplates, onChange }: TemplateAutomationEditorProps) => (
  <div className="space-y-4">
    <GroupEditor title="付款后自动发货" hint="买家付款后按顺序执行；全部成功后按账号设置确认发货。多规格商品必须为每个规格组合配置。" group={automation.paidDelivery} scopes={scopes} deliveryTemplates={deliveryTemplates} onChange={/* 写回付款发货。 */ next => onChange({ ...automation, paidDelivery: next })} />
    <GroupEditor title="评价赠品" hint="买家评价后发送的赠品。" group={automation.reviewGift} scopes={scopes} deliveryTemplates={deliveryTemplates} onChange={/* 写回评价赠品。 */ next => onChange({ ...automation, reviewGift: next })} />
    <section className="space-y-3 rounded-2xl bg-gray-50 border border-gray-100 p-4">
      <label className="flex items-center gap-2 text-sm font-extrabold text-gray-900"><input type="checkbox" checked={automation.reviewRequest.enabled} onChange={/* 切换求评价。 */ event => onChange({ ...automation, reviewRequest: { ...automation.reviewRequest, enabled: event.target.checked } })} />求评价</label>
      {automation.reviewRequest.enabled && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-gray-600">发货后（小时）<input aria-label="发货后小时数" type="number" min={1} className={`${inputClass} mt-1 w-full`} value={automation.reviewRequest.afterShippedHours} onChange={/* 修改等待小时数。 */ event => onChange({ ...automation, reviewRequest: { ...automation.reviewRequest, afterShippedHours: Number(event.target.value) } })} /></label>
          <label className="text-xs text-gray-600">最多发送次数<input aria-label="最多发送次数" type="number" min={1} className={`${inputClass} mt-1 w-full`} value={automation.reviewRequest.maxAttempts} onChange={/* 修改最大次数。 */ event => onChange({ ...automation, reviewRequest: { ...automation.reviewRequest, maxAttempts: Number(event.target.value) } })} /></label>
          <label className="text-xs text-gray-600">发送延迟（秒）<input aria-label="求评价延迟秒数" type="number" min={0} className={`${inputClass} mt-1 w-full`} value={automation.reviewRequest.delaySeconds} onChange={/* 修改延迟。 */ event => onChange({ ...automation, reviewRequest: { ...automation.reviewRequest, delaySeconds: Number(event.target.value) } })} /></label>
          <label className="text-xs text-gray-600 sm:col-span-3">求评价消息<textarea aria-label="求评价消息" className={`${inputClass} mt-1 min-h-20 w-full`} value={automation.reviewRequest.message} onChange={/* 修改求评价消息。 */ event => onChange({ ...automation, reviewRequest: { ...automation.reviewRequest, message: event.target.value } })} /></label>
        </div>
      )}
    </section>
  </div>
);
