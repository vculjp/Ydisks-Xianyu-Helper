import React, { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Sparkles, X } from 'lucide-react';
import { collectProductDetails, collectorErrorMessage, rewriteProductWithAI } from '../api';
import type { CollectedProduct } from '../types';

/** CollectorItemModalProps 描述单件采集商品详情补抓与 AI 防重改写弹窗属性。 */
export interface CollectorItemModalProps {
  /** item 是当前正在查看或编辑的采集商品；为空时不渲染弹窗。 */
  item: CollectedProduct | null;
  /** cookieId 是用于补抓完整详情的当前选中采集账号标识。 */
  cookieId: string;
  /** onClose 关闭当前详情与改写弹窗。 */
  onClose: () => void;
  /** onSave 将编辑或改写后的商品字段写回采集列表。 */
  onSave: (updated: CollectedProduct) => void;
  /** onSaveAndOpenTemplate 保存当前修改并立即打开转存模板弹窗。 */
  onSaveAndOpenTemplate: (updated: CollectedProduct) => void;
}

/** CollectorItemModal 提供单品多图预览、详情补抓及 AI 标题/文案防重改写编辑器。 */
export const CollectorItemModal: React.FC<CollectorItemModalProps> = ({
  item,
  cookieId,
  onClose,
  onSave,
  onSaveAndOpenTemplate,
}) => {
  // draftTitle 与 setDraftTitle 管理弹窗内编辑中的商品标题文本。
  const [draftTitle, setDraftTitle] = useState('');
  // draftDesc 与 setDraftDesc 管理弹窗内编辑中的商品详情正文。
  const [draftDesc, setDraftDesc] = useState('');
  // draftPrice 与 setDraftPrice 管理弹窗内可微调的展示售价文本。
  const [draftPrice, setDraftPrice] = useState('');
  // draftImages 与 setDraftImages 管理已采集或补抓到的全部商品主图链接。
  const [draftImages, setDraftImages] = useState<string[]>([]);
  // fullDetailLoaded 与 setFullDetailLoaded 标记当前草稿是否已完成详情补抓。
  const [fullDetailLoaded, setFullDetailLoaded] = useState(false);
  // customInstruction 与 setCustomInstruction 保存用户的可选 AI 附加改写指令。
  const [customInstruction, setCustomInstruction] = useState('');
  // loadingDetail 与 setLoadingDetail 表示是否正在请求闲鱼详情接口。
  const [loadingDetail, setLoadingDetail] = useState(false);
  // rewriting 与 setRewriting 表示是否正在请求大模型改写接口。
  const [rewriting, setRewriting] = useState(false);
  // statusMessage 与 setStatusMessage 展示弹窗内的成功提示或失败原因。
  const [statusMessage, setStatusMessage] = useState<{ /** tone 区分成功与警告颜色。 */ tone: 'ok' | 'err'; /** text 是提示文本。 */ text: string } | null>(null);

  /** effect 在切换目标商品时同步表单草稿初始值。 */
  useEffect(/* syncDraftEffect 在打开不同商品弹窗时重置编辑草稿。 */ () => {
    if (!item) return;
    setDraftTitle(item.title);
    setDraftDesc(item.description || item.title);
    setDraftPrice(item.price);
    setDraftImages(item.imageUrls.length > 0 ? [...item.imageUrls] : (item.picUrl ? [item.picUrl] : []));
    setFullDetailLoaded(item.hasFullDetail);
    setStatusMessage(null);
  }, [item]);

  if (!item) return null;

  /** buildUpdatedItem 组装包含当前编辑结果的商品快照。 */
  const buildUpdatedItem = (): CollectedProduct => ({
    ...item,
    title: draftTitle.trim() || item.title,
    description: draftDesc.trim() || draftTitle.trim() || item.title,
    price: draftPrice.trim() || item.price,
    picUrl: draftImages[0] || item.picUrl,
    imageUrls: draftImages,
    hasFullDetail: fullDetailLoaded,
  });

  /** handleFetchFullDetail 调用单品详情接口补抓完整描述文案与全部高清原图。 */
  const handleFetchFullDetail = async (): Promise<void> => {
    if (!cookieId) {
      setStatusMessage({ tone: 'err', text: '请先在页面顶部选择一个采集账号再补抓详情' });
      return;
    }
    setLoadingDetail(true);
    setStatusMessage(null);
    try {
      // batch 是单品精准采集接口返回的详情结果。
      const batch = await collectProductDetails(cookieId, [item.itemId]);
      if (batch.items.length > 0) {
        // fetched 是补抓回来的完整商品详情对象。
        const fetched = batch.items[0];
        setDraftTitle(fetched.title);
        setDraftDesc(fetched.description);
        setDraftPrice(fetched.price || draftPrice);
        setDraftImages(fetched.imageUrls);
        setFullDetailLoaded(true);
        setStatusMessage({ tone: 'ok', text: `已成功补抓完整文案与 ${fetched.imageUrls.length} 张高清主图` });
      } else if (batch.errors.length > 0) {
        setStatusMessage({ tone: 'err', text: batch.errors[0].message });
      }
    } catch (failure /* failure 是详情补抓请求抛出的异常。 */) {
      setStatusMessage({ tone: 'err', text: collectorErrorMessage(failure, '补抓商品详情失败') });
    } finally {
      setLoadingDetail(false);
    }
  };

  /** handleAIRewrite 调用系统大模型对当前标题和详情文案做防同质化改写。 */
  const handleAIRewrite = async (): Promise<void> => {
    setRewriting(true);
    setStatusMessage(null);
    try {
      // rewritten 是大模型生成的差异化标题与描述。
      const rewritten = await rewriteProductWithAI(draftTitle, draftDesc, customInstruction);
      setDraftTitle(rewritten.title);
      setDraftDesc(rewritten.description);
      setStatusMessage({ tone: 'ok', text: 'AI 防重改写已完成，请核对下方标题与文案' });
    } catch (failure /* failure 是大模型改写调用失败原因。 */) {
      setStatusMessage({ tone: 'err', text: collectorErrorMessage(failure, '调用系统 AI 改写失败') });
    } finally {
      setRewriting(false);
    }
  };

  /** handleRestoreOriginal 一键恢复到未改写前的源商品标题与描述。 */
  const handleRestoreOriginal = (): void => {
    setDraftTitle(item.title);
    setDraftDesc(item.description || item.title);
    setStatusMessage(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900">商品详情预览与 AI 防重改写</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              商品 ID：{item.itemId} · 卖家：{item.sellerNick || item.sellerId || '未知'} · {item.wantCount < 0 ? '想要人数未知' : `${item.wantCount} 人想要`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="关闭弹窗">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {statusMessage && (
            <div className={`rounded-xl px-4 py-2.5 text-xs font-medium ${statusMessage.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {statusMessage.text}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-bold ${fullDetailLoaded ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {fullDetailLoaded ? `已含完整详情 (${draftImages.length} 图)` : '当前仅列表摘要 (建议补抓多图与文案)'}
              </span>
              <a href={item.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-sky-600 hover:underline">
                打开闲鱼原帖 <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <button
              type="button"
              disabled={loadingDetail}
              onClick={handleFetchFullDetail}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-xs ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingDetail ? 'animate-spin' : ''}`} />
              {loadingDetail ? '正在补抓详情...' : '补抓完整文案与全部主图'}
            </button>
          </div>

          {draftImages.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-bold text-slate-700">商品主图预览（共 {draftImages.length} 张，转存时将自动下载至本地图片库）</div>
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-9">
                {draftImages.map(/* imgUrl 是单张主图地址，idx 是排序下标。 */ (imgUrl, idx) => (
                  <a key={imgUrl} href={imgUrl} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                    <img src={imgUrl} alt={`主图 ${idx + 1}`} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    {idx === 0 && <span className="absolute left-1 top-1 rounded bg-sky-600 px-1 text-[10px] font-bold text-white">封面</span>}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs font-bold text-slate-700">商品标题（闲鱼展示建议 30 字内）</label>
              <input
                type="text"
                value={draftTitle}
                onChange={/* event 携带标题输入最新值。 */ event => setDraftTitle(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">参考售价 (元)</label>
              <input
                type="text"
                value={draftPrice}
                onChange={/* event 携带售价输入最新值。 */ event => setDraftPrice(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-hidden"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">商品详情文案</label>
            <textarea
              rows={6}
              value={draftDesc}
              onChange={/* event 携带详情描述最新文本。 */ event => setDraftDesc(event.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm leading-relaxed text-slate-800 focus:border-sky-500 focus:outline-hidden"
            />
          </div>

          <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-violet-800">
                <Sparkles className="h-4 w-4 text-violet-600" /> AI 防同质化改写（自动清理原卖家昵称与引流词）
              </span>
              <button type="button" onClick={handleRestoreOriginal} className="text-xs font-medium text-slate-500 hover:text-slate-800">
                还原初始文本
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                placeholder="可选：补充改写要求，如“突出拍下24小时自动秒发网盘链接，语气专业简洁”"
                value={customInstruction}
                onChange={/* event 携带附加改写要求文本。 */ event => setCustomInstruction(event.target.value)}
                className="flex-1 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-violet-500 focus:outline-hidden"
              />
              <button
                type="button"
                disabled={rewriting}
                onClick={handleAIRewrite}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {rewriting ? 'AI 改写中...' : '一键 AI 改写'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/70">
            取消
          </button>
          <button
            type="button"
            onClick={/* 保存当前改动回列表并关闭弹窗。 */ () => {
              onSave(buildUpdatedItem());
              onClose();
            }}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50"
          >
            仅保存修改到列表
          </button>
          <button
            type="button"
            onClick={/* 保存当前改动并直接进入转存模板流程。 */ () => onSaveAndOpenTemplate(buildUpdatedItem())}
            className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-700"
          >
            保存并转存为商品模板 →
          </button>
        </div>
      </div>
    </div>
  );
};
