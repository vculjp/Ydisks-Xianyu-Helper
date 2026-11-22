import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, FolderPlus, Sparkles, X, XCircle } from 'lucide-react';
import { collectorErrorMessage, saveProductsToTemplates } from '../api';
import { classifyTemplateSaveRecovery, incompleteDescriptionItems } from '../templateSaveRecovery';
import { notify } from '../../../../shared/ui/feedback';
import type {
  CollectedProduct,
  CollectorDeliveryTemplateOption,
  CollectorPriceMode,
  CollectorSaveTemplatesSummary,
} from '../types';

/** SaveTemplatesModalProps 描述批量转存到本地商品模板库弹窗所需的属性。 */
export interface SaveTemplatesModalProps {
  /** open 控制弹窗是否展示。 */
  open: boolean;
  /** items 是当前已勾选要转存的商品列表。 */
  items: CollectedProduct[];
  /** cookieId 是用于按需补抓缺失详情的采集账号标识。 */
  cookieId: string;
  /** deliveryTemplates 是可供一键绑定的发货模板列表。 */
  deliveryTemplates: CollectorDeliveryTemplateOption[];
  /** onClose 关闭转存弹窗。 */
  onClose: () => void;
  /** onNavigateToLibrary 跳转到本地资源库页面以便立即多店批量发布。 */
  onNavigateToLibrary?: () => void;
}

/** SaveTemplatesModal 将勾选的采集商品批量下载主图、可选 AI 改写并创建为本地资源库商品模板。 */
export const SaveTemplatesModal: React.FC<SaveTemplatesModalProps> = ({
  open,
  items,
  cookieId,
  deliveryTemplates,
  onClose,
  onNavigateToLibrary,
}) => {
  // fetchMissingDetail 与 setFetchMissingDetail 控制是否额外请求详情接口补抓多图（默认关闭以零平台请求极速入库）。
  const [fetchMissingDetail, setFetchMissingDetail] = useState(false);
  // enableAiRewrite 与 setEnableAiRewrite 控制入库前是否批量执行 AI 防重改写。
  const [enableAiRewrite, setEnableAiRewrite] = useState(false);
  // customInstruction 与 setCustomInstruction 保存批量 AI 改写的附加要求。
  const [customInstruction, setCustomInstruction] = useState('');
  // priceMode 与 setPriceMode 控制售价换算模式（保持原价、加减价或统一固定价）。
  const [priceMode, setPriceMode] = useState<CollectorPriceMode>('keep');
  // priceValue 与 setPriceValue 保存加减价差额或固定售价输入。
  const [priceValue, setPriceValue] = useState('9.90');
  // quantity 与 setQuantity 保存模板默认上架库存。
  const [quantity, setQuantity] = useState(5);
  // postageMode 与 setPostageMode 保存模板邮费方式（虚拟商品默认无需邮寄）。
  const [postageMode, setPostageMode] = useState<'none' | 'free' | 'source'>('none');
  // selectedTemplateId 与 setSelectedTemplateId 保存可选绑定的发货模板主键（0 表示暂不绑定）。
  const [selectedTemplateId, setSelectedTemplateId] = useState<number>(0);
  // customVars 与 setCustomVars 保存发货模板所需的自定义变量键值（如网盘 link）。
  const [customVars, setCustomVars] = useState<Record<string, string>>({});
  // submitting 与 setSubmitting 标记是否正在后台下载图片并创建模板。
  const [submitting, setSubmitting] = useState(false);
  // submitError 与 setSubmitError 保存整批请求级别的校验或网络失败原因。
  const [submitError, setSubmitError] = useState('');
  // summary 与 setSummary 保存执行完成后的逐件成功与失败汇总。
  const [summary, setSummary] = useState<CollectorSaveTemplatesSummary | null>(null);
  // submittedCount 与 setSubmittedCount 保存本次发出请求时的商品数，避免结果返回后勾选数变化造成统计误导。
  const [submittedCount, setSubmittedCount] = useState(0);
  // submittingRef 是转存请求的同步锁，覆盖按钮状态更新前的快速双击。
  const submittingRef = useRef(false);

  useEffect(/* modalCloseCleanupEffect 在父组件取消选品时清空旧批次反馈，避免下次打开看到其他商品的失败信息。 */ () => {
    if (!open) {
      setSummary(null);
      setSubmitError('');
      setSubmittedCount(0);
    }
  }, [open]);

  /** handleCloseModal 结束本次转存结果展示；运行中禁止从界面丢弃尚未确认的请求状态。 */
  const handleCloseModal = (): void => {
    if (submitting) return;
    setSummary(null);
    setSubmitError('');
    setSubmittedCount(0);
    onClose();
  };

  if (!open || items.length === 0) return null;

  // activeDeliveryTemplate 查找当前选中的发货模板定义以渲染其自定义变量输入框。
  const activeDeliveryTemplate = deliveryTemplates.find(/* tpl 匹配选中的发货模板 ID。 */ tpl => tpl.id === selectedTemplateId);
  // recoveryKind 仅依据这次实际返回的错误分类，绝不发起额外的采集或账号状态查询。
  const recoveryKind = summary ? classifyTemplateSaveRecovery(summary) : null;
  // missingDescriptions 是当前待转存商品中缺少真实详情的标识，未经补抓或人工填写不允许创建标题式伪描述。
  const missingDescriptions = incompleteDescriptionItems(items);

  /** returnToSaveSettings 保留本次已选商品和其它发布参数，按用户选择决定是否禁用详情补抓。 */
  const returnToSaveSettings = (disableDetailFetch: boolean): void => {
    if (disableDetailFetch) setFetchMissingDetail(false);
    setSummary(null);
    setSubmitError('');
  };

  /** handleStartSave 提交批量下图与创建本地商品模板请求。 */
  const handleStartSave = async (): Promise<void> => {
    if (submittingRef.current) return;
    if (!fetchMissingDetail && missingDescriptions.length > 0) {
      setSubmitError(`有 ${missingDescriptions.length} 件商品缺少真实详情描述。请先逐件补全正文，或开启详情补抓；不能用标题代替描述入库。`);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    setSummary(null);
    setSubmittedCount(items.length);
    try {
      // res 是后端批量下载图片并写入模板库的汇总结果。
      const res = await saveProductsToTemplates({
        cookieId,
        fetchDetailIfMissing: fetchMissingDetail,
        enableAiRewrite,
        customInstruction,
        priceMode,
        priceValue,
        quantity,
        postageMode,
        deliveryTemplateId: selectedTemplateId,
        customVariables: customVars,
        items,
      });
      setSummary(res);
      if (res.failed > 0 || res.abortedByRisk) {
        notify('warning', `转存完成：成功 ${res.succeeded} 件，失败 ${res.failed} 件`);
      } else {
        notify('success', `已转存 ${res.succeeded} 件商品模板`);
      }
    } catch (failure /* failure 是批量转存请求抛出的异常。 */) {
      // failureMessage 是整批转存失败的可展示原因。
      const failureMessage = collectorErrorMessage(failure, '批量转存商品模板失败');
      setSubmitError(failureMessage);
      notify('error', failureMessage);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <FolderPlus className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">一键转存到本地资源库（商品模板）</h3>
              <p className="text-xs text-slate-500">已选择 {items.length} 件商品（单批最多 20 件），自动下载高清主图去重入库</p>
            </div>
          </div>
          <button type="button" onClick={handleCloseModal} disabled={submitting} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="关闭转存弹窗">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {submitError && (
          <div className="rounded-xl bg-danger-50 px-4 py-3 text-xs font-semibold text-danger-700">{submitError}</div>
          )}

          {!summary ? (
            <>
              <div className="space-y-2.5 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={fetchMissingDetail}
                    onChange={/* event 切换是否自动补抓缺失详情。 */ event => setFetchMissingDetail(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600"
                  />
                  <span className="text-xs text-slate-700">
                    <strong className="font-bold text-slate-900">可选：尝试补抓详情页多图与长文案</strong>
                    <span className="block text-slate-500">关闭时仅使用已有快照；开启时必须成功取得完整详情，否则该商品不会创建新模板。请核对已有快照及图片的使用授权。</span>
                  </span>
                </label>
                {missingDescriptions.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900" role="alert">
                    已选商品中有 {missingDescriptions.length} 件缺少完整正文或正文只有标题。{fetchMissingDetail
                      ? '本次将尝试补抓真实详情，补抓失败的商品不会保存为完整模板。'
                      : '当前不能直接转存。请先在单品详情预览中填写真实正文，或勾选上方「补抓详情页多图与长文案」。'}
                  </div>
                )}

                <label className="flex cursor-pointer items-start gap-2.5 pt-1">
                  <input
                    type="checkbox"
                    checked={enableAiRewrite}
                    onChange={/* event 切换是否在入库前执行批量 AI 改写。 */ event => setEnableAiRewrite(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600"
                  />
                  <span className="text-xs text-slate-700">
                    <strong className="inline-flex items-center gap-1 font-bold text-violet-800">
                      <Sparkles className="h-3.5 w-3.5" /> 入库前自动执行 AI 标题与文案防重改写
                    </strong>
                    <span className="block text-slate-500">需已在「系统与AI」配置可用模型密钥；自动去除原卖家昵称与引流词</span>
                  </span>
                </label>

                {enableAiRewrite && (
                  <input
                    type="text"
                    placeholder="可选：批量改写附加指令，如“结尾统一加上：24小时全自动秒发网盘学习链接”"
                    value={customInstruction}
                    onChange={/* event 更新批量改写附加说明。 */ event => setCustomInstruction(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-violet-500 focus:outline-hidden"
                  />
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">售价策略</label>
                  <select
                    value={priceMode}
                    onChange={/* event 切换定价策略枚举。 */ event => setPriceMode(event.target.value as CollectorPriceMode)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800"
                  >
                    <option value="keep">照搬源商品价格</option>
                    <option value="offset">源价格加减金额 (如 -0.50)</option>
                    <option value="fixed">统一固定售价</option>
                  </select>
                </div>
                {priceMode !== 'keep' && (
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      {priceMode === 'offset' ? '加减金额 (元，负数降价)' : '固定售价 (元)'}
                    </label>
                    <input
                      type="text"
                      value={priceValue}
                      onChange={/* event 更新价格策略数值文本。 */ event => setPriceValue(event.target.value)}
                      placeholder={priceMode === 'offset' ? '-0.50' : '9.90'}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">默认库存 / 邮费</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={/* event 更新默认上架库存整数。 */ event => setQuantity(Math.max(1, Number(event.target.value) || 1))}
                      className="w-20 rounded-xl border border-slate-200 px-2.5 py-2 text-xs text-slate-900"
                    />
                    <select
                      value={postageMode}
                      onChange={/* event 选择明确的运费处理方式，来源方式缺失则后端阻止不确定转存。 */ event => setPostageMode(event.target.value as 'none' | 'free' | 'source')}
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800"
                    >
                      <option value="none">无需邮寄 (虚拟推荐)</option>
                      <option value="free">包邮</option>
                      <option value="source">沿用原商品运费（仅完整采集后）</option>
                    </select>
                  </div>
                </div>
              </div>
              <p className="text-xs text-amber-800">转存时会保留原商品链接、可获取的类目/规格/SKU/公开属性，缺失资料标记待核实；原卖家地址不会自动作为你的发货地，原商品库存不代表你当前库存。</p>

              <div className="rounded-xl border border-slate-200 p-3.5">
                <label className="mb-1.5 block text-xs font-bold text-slate-700">可选：预绑定自动发货模板</label>
                <select
                  value={selectedTemplateId}
                  onChange={/* event 选择默认绑定的发货模板主键。 */ event => setSelectedTemplateId(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
                >
                  <option value={0}>暂不绑定（进入本地资源库后再按每个商品单独填写网盘链接）</option>
                  {deliveryTemplates.map(/* tpl 渲染发货模板选项。 */ tpl => (
                    <option key={tpl.id} value={tpl.id}>
                      #{tpl.id} · {tpl.name}
                    </option>
                  ))}
                </select>
                {activeDeliveryTemplate && activeDeliveryTemplate.customKeys.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {activeDeliveryTemplate.customKeys.map(/* varKey 是模板要求的自定义变量键。 */ varKey => (
                      <div key={varKey}>
                        <label className="mb-1 block text-[11px] font-bold text-slate-600">模板变量 {`{{custom.${varKey}}}`} 值（必填）</label>
                        <input
                          type="text"
                          value={customVars[varKey] ?? ''}
                          onChange={/* event 更新对应模板变量的文本值。 */ event => setCustomVars(/* prev 是变更前的变量键值字典。 */ prev => ({ ...prev, [varKey]: event.target.value }))}
                          placeholder={`填写 ${varKey} 内容，如网盘分享链接与提取码`}
                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-900"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className={`rounded-xl p-4 text-xs font-bold ${summary.failed === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                本次提交 {summary.total} 件：已保存或复用 {summary.succeeded} 条模板，失败 {summary.failed} 条。相同请求复用原模板，请在资源库核对内容。
                {summary.total !== submittedCount && `（提交数量与服务端计数不一致：发出 ${submittedCount} 件，请人工核对）`}
                {summary.abortedByRisk && '（本批次因平台安全状态或本地任务冲突停止，剩余商品未执行）'}
              </div>
              {recoveryKind && (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                  <p className="font-bold">{recoveryKind === 'busy'
                    ? '当前有其他采集或账号任务在运行，详情补抓被安全拦截；这不是滑块验证，也不需要重新登录。'
                    : '详情补抓遇到平台安全验证或风控，打开普通闲鱼页面不一定会出现滑块。'}</p>
                  <p>{recoveryKind === 'busy'
                    ? '如果需要完整详情，请先让当前采集任务结束，再手动提交；不会自动排队或补发请求。'
                    : '请先通过闲鱼官方渠道处理验证并核对账号状态，不要连续重试详情采集。'}</p>
                  <p>也可以关闭补抓，仅使用已采集到的商品资料尝试转存；缺失的详情、图片、类目和规格不会自动补齐，入库后仍需核对。</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={/* 禁用补抓并保留商品勾选和价格等设置，下一次提交不请求详情接口。 */ () => returnToSaveSettings(true)}
                      className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-bold text-amber-900 hover:bg-amber-100"
                    >
                      不补抓详情，返回设置
                    </button>
                    <button
                      type="button"
                      onClick={/* 保留补抓开关和其它表单参数，仅返回设置供用户等待任务结束后手动提交。 */ () => returnToSaveSettings(false)}
                      className="rounded-lg border border-amber-300 px-3 py-2 font-bold text-amber-900 hover:bg-amber-100"
                    >
                      保留补抓，返回设置
                    </button>
                  </div>
                </div>
              )}
              <div className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                {summary.results.map(/* row 是单条商品的转存结果记录。 */ row => (
                  <div key={`${row.itemId}-${row.templateId}`} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-slate-800">{row.title || row.itemId}</div>
                        {row.errorReason && <div className="mt-0.5 text-danger-600">{row.errorReason}</div>}
                    </div>
                    {row.success ? (
                      <span className="inline-flex shrink-0 items-center gap-1 font-bold text-emerald-600">
                        <CheckCircle2 className="h-4 w-4" /> 模板 #{row.templateId} ({row.imageCount}图)
                      </span>
                    ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 font-bold text-danger-600">
                        <XCircle className="h-4 w-4" /> 失败
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">
          <button type="button" onClick={handleCloseModal} disabled={submitting} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/70 disabled:cursor-not-allowed disabled:opacity-40">
            {summary ? '关闭窗口' : '取消'}
          </button>
          {!summary ? (
            <button
              type="button"
              disabled={submitting || (!fetchMissingDetail && missingDescriptions.length > 0)}
              onClick={handleStartSave}
              className="rounded-xl bg-sky-600 px-5 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {submitting ? '正在下载主图并生成模板...' : `确认转存 ${items.length} 件商品`}
            </button>
          ) : (
            summary.succeeded > 0 && onNavigateToLibrary && (
              <button
                type="button"
                onClick={/* 关闭弹窗并跳转到本地资源库进行多店批量上架。 */ () => {
                  handleCloseModal();
                  onNavigateToLibrary();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                前往本地资源库一键多店上架 <ArrowRight className="h-4 w-4" />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
};
