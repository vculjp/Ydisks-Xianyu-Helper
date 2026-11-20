import { useEffect,useRef,useState } from 'react';
import { readSupportWorkspace,saveSupportConfig,previewSupport,setSupportTakeover } from '../api';
import type { SupportConfig,SupportEntry,SupportPreviewResult,SupportTakeover } from '../api';
import type { SupportCenterProps } from '../types';
import { accountLabel } from '../utils';

/** emptyEntry 创建不包含密钥、链接或买家资料的知识草稿。 */
const emptyEntry = (): SupportEntry => ({ scope:'global',account_id:'',item_id:'',title:'',question:'',answer:'' });
/** scopeName 是三个知识归属层级的展示名称。 */
const scopeName = { global:'全局',account:'店铺',item:'商品' } as const;
/** reasonName 是人工接管来源的可读名称。 */
const reasonName: Record<string,string> = {human:'人工回复',risk:'安全检查或转人工',operator:'手动接管',resumed:'人工恢复'};
/** fieldClass 是和项目原有设置表单一致的输入样式。 */
const fieldClass = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800';
/** buttonClass 是用于本地数据操作的次级按钮样式。 */
const buttonClass = 'rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50';

/** SupportCenter 是 P0 客服知识、FAQ、沙盒、安全门禁和人工接管的本地工作台。 */
const SupportCenter = ({accountId,accounts,items}: SupportCenterProps) => {
  // config 保存已加载的知识配置草稿；没有成功读取时禁止保存。
  const [config,setConfig]=useState<SupportConfig|null>(null);
  // saved 保留最后确认的配置快照，用于识别未保存修改。
  const [saved,setSaved]=useState('');
  // draft 是正在录入或编辑的一条知识。
  const [draft,setDraft]=useState<SupportEntry>(emptyEntry);
  // editIndex 是编辑索引，-1 表示新增。
  const [editIndex,setEditIndex]=useState(-1);
  // takeovers 是当前用户已持久化的会话接管记录。
  const [takeovers,setTakeovers]=useState<SupportTakeover[]>([]);
  // busy 表示工作台正在执行唯一一次本地请求。
  const [busy,setBusy]=useState(false);
  // feedback 保存不含密钥或原始失败正文的诊断。
  const [feedback,setFeedback]=useState('');
  // previewItem 是沙盒选择的本地商品。
  const [previewItem,setPreviewItem]=useState('');
  // question 仅保存商家主动输入的合成测试问题。
  const [question,setQuestion]=useState('');
  // result 是只读沙盒返回的质量决策。
  const [result,setResult]=useState<SupportPreviewResult|null>(null);
  // resultAccount 记录候选回复所依据的店铺，旧店铺的迟到结果不可展示。
  const [resultAccount,setResultAccount]=useState('');
  // chatID 是操作员从本地聊天会话复制的会话标识。
  const [chatID,setChatID]=useState('');
  // pending 保存当前唯一请求的 AbortController，防止重复提交或卸载后回写。
  const pending=useRef<AbortController|null>(null);
  // dirty 表示知识配置尚有未保存修改。
  const dirty=config!==null && JSON.stringify(config)!==saved;

  /** runExclusive 执行一次明确的操作，切页卸载取消请求且不覆盖后来结果。 */
  const runExclusive=async (task:(signal:AbortSignal)=>Promise<void>,failure:string) => {
    if (pending.current) return;
    // controller 只拥有本轮请求。
    const controller=new AbortController();
    pending.current=controller;
    setBusy(true);
    setFeedback('');
    try { await task(controller.signal); }
    catch { if (!controller.signal.aborted) setFeedback(failure); }
    finally {
      if (pending.current===controller) { pending.current=null; setBusy(false); }
    }
  };

  /** loadWorkspace 明确读取本地知识与接管状态；可选择保留未保存的配置草稿。 */
  const loadWorkspace=async (signal:AbortSignal,replaceConfig:boolean) => {
    // workspace 是当前用户读取成功的配置和会话状态。
    const workspace=await readSupportWorkspace({signal});
    if (signal.aborted) return;
    if (replaceConfig) { setConfig(workspace.config);setSaved(JSON.stringify(workspace.config)); }
    setTakeovers(workspace.takeovers);
  };

  useEffect(/* 首次进入中心时读取本地配置，离开时取消并禁止迟到响应写入。 */ () => {
    void runExclusive(/* 首次加载只读取本地数据。 */ signal=>loadWorkspace(signal,true),'读取客服配置失败，请刷新重试；当前禁止保存');
    return /* 清理组件的独立请求。 */ () => { pending.current?.abort();pending.current=null; };
  },[]);

  useEffect(/* 切换店铺后清空旧店铺的沙盒和接管输入，避免跨店展示。 */ () => {
    setPreviewItem('');setQuestion('');setResult(null);setChatID('');
  },[accountId]);

  /** changeDraft 仅更新知识草稿，不直接写入服务器。 */
  const changeDraft=(patch:Partial<SupportEntry>)=>setDraft(/* prev 是当前条目草稿。 */ prev=>({...prev,...patch}));
  /** putDraft 将一条经过基本校验的草稿加入待保存配置。 */
  const putDraft=() => {
    if (!config) return;
    if (!draft.title.trim() || !draft.answer.trim() || (draft.scope!=='global'&&!draft.account_id) || (draft.scope==='item'&&!draft.item_id)) { setFeedback('请填写标题、正文和所需归属');return; }
    // entries 保存新的完整草稿，实际持久化由下方保存按钮触发。
    const entries=[...config.entries];
    if (editIndex>=0) entries[editIndex]={...draft};
    else { if (entries.length>=60) { setFeedback('最多 60 条资料');return; } entries.push({...draft}); }
    setConfig({...config,entries});setDraft(emptyEntry());setEditIndex(-1);setFeedback('已加入草稿，请点击保存知识配置');
  };
  /** persist 保存当前知识配置后重新读取真实持久化结果。 */
  const persist=() => {
    if (!config) return;
    void runExclusive(/* 服务端校验账号归属、资料长度和敏感内容。 */ async signal=>{
      await saveSupportConfig(config,{signal});
      await loadWorkspace(signal,true);
      if (!signal.aborted) setFeedback('知识配置已保存');
    },'保存失败：请检查资料归属、重复 FAQ、长度及是否包含链接或密钥');
  };
  /** runPreview 只使用已保存配置与当前选中商品执行合成问题。 */
  const runPreview=() => {
    if (!accountId || !question.trim() || dirty) return;
    setResult(null);
    void runExclusive(/* 沙盒响应仅用于展示，不投递买家。 */ async signal=>{
      // preview 是后端共享决策器返回的实际预览。
      const preview=await previewSupport(accountId,previewItem,question,{signal});
      if (!signal.aborted) {setResultAccount(accountId);setResult(preview);}
    },'沙盒请求失败，请检查商品归属、模型连接或超时');
  };
  /** changeTakeover 执行一次明确的会话暂停或恢复，并只刷新接管列表。 */
  const changeTakeover=(id:string,chat:string,paused:boolean)=>{
    if (!id || !chat.trim()) return;
    void runExclusive(/* 仅持久化接管状态，不主动联网或发消息。 */ async signal=>{
      await setSupportTakeover(id,chat,paused,{signal});
      await loadWorkspace(signal,false);
      if (!signal.aborted) { setChatID('');setFeedback(paused?'已人工接管，自动回复暂停':'已恢复该会话的客服处理'); }
    },'接管状态保存失败，请核对会话和账号');
  };
  // ownItems 仅展示当前知识草稿所选账号的商品。
  const ownItems=items.filter(/* item 是草稿归属账号下的商品。 */ item=>item.cookie_id===draft.account_id);
  // sandboxItems 只展示当前沙盒选中账号下的本地商品。
  const sandboxItems=items.filter(/* item 是当前沙盒的候选商品。 */ item=>item.cookie_id===accountId);
  // visibleTakeovers 只显示当前用户账号范围内仍生效的接管记录。
  const visibleTakeovers=takeovers.filter(/* row 按账号与有效期过滤。 */ row=>(!accountId||row.account_id===accountId)&&accounts.some(/* account 确保账号依然属于当前用户。 */ account=>account.id===row.account_id)&&(row.until===-1||row.until>Date.now()/1000));

  return <div className="space-y-5">
    <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-extrabold text-gray-900">AI 客服 · 知识与安全中心</h3><p className="text-xs text-gray-500 mt-1">本地资料、FAQ、回复质量门禁和人工接管</p></div>
        <button className={buttonClass} disabled={busy||dirty} onClick={/* 重新读取已保存的配置。 */ ()=>void runExclusive(/* 本地刷新操作。 */ signal=>loadWorkspace(signal,true),'读取客服配置失败')}>刷新</button>
      </div>
      {feedback&&<p role="status" className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">{feedback}</p>}
      {config&&<>
        <label className="flex items-center gap-3 text-sm font-bold"><input type="checkbox" checked={config.enabled} disabled={busy} onChange={/* event 切换用户级受控客服草稿，保存后才生效。 */ event=>setConfig({...config,enabled:event.target.checked})}/>启用受控客服（本人全部店铺）</label>
        <p className="text-xs leading-6 text-gray-500">须在账号 AI 设置启用相应工作模式。开启后原生 AI 使用知识库和回复检查，外部 Agent 不参与；固定关键词、首次回复、发货规则保持原有行为。高风险诉求转人工，不发送候选危险内容。规则是启发式检查，不保证拦截所有泄露和错误承诺。</p>
        <div className="flex gap-2"><button className="ios-btn-primary rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50" disabled={busy||!dirty} onClick={persist}>保存知识配置</button><span className="self-center text-xs text-gray-500">{dirty?'存在未保存修改':'已保存 / 无修改'}</span></div>
      </>}
      {!config&&!busy&&<p className="text-sm text-gray-500">配置未加载，暂不可编辑。</p>}
    </section>
    {config&&<section className="rounded-2xl bg-white border border-gray-200 p-5 space-y-4">
      <h3 className="font-extrabold">三级知识库 / FAQ（{config.entries.length}/60）</h3>
      <p className="text-xs text-gray-500">问题留空为公开事实资料；填写问题为精确匹配 FAQ。商品优先于店铺、店铺优先于全局。不要录入网盘链接、卡密、密码或个人联系方式。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-semibold">归属<select className={fieldClass} value={draft.scope} disabled={busy} onChange={/* event 改变归属时清空不适用标识。 */ event=>changeDraft({scope:event.target.value as SupportEntry['scope'],account_id:event.target.value==='global'?'':accountId,item_id:''})}>{Object.entries(scopeName).map(/* pair 渲染知识层级。 */ pair=><option key={pair[0]} value={pair[0]}>{pair[1]}</option>)}</select></label>
        {draft.scope!=='global'&&<label className="space-y-1 text-xs font-semibold">店铺<select className={fieldClass} value={draft.account_id} disabled={busy} onChange={/* event 选择归属店铺并清空旧商品。 */ event=>changeDraft({account_id:event.target.value,item_id:''})}><option value="">选择本人店铺</option>{accounts.map(/* account 是知识归属的候选店铺。 */ account=><option key={account.id} value={account.id}>{accountLabel(account)}</option>)}</select></label>}
        {draft.scope==='item'&&<label className="space-y-1 text-xs font-semibold">商品<select className={fieldClass} value={draft.item_id} disabled={busy} onChange={/* event 选择本地商品。 */ event=>changeDraft({item_id:event.target.value})}><option value="">选择商品</option>{ownItems.map(/* item 是当前店铺本地商品。 */ item=><option key={item.item_id} value={item.item_id}>{item.item_title||item.item_id}</option>)}</select></label>}
        <label className="space-y-1 text-xs font-semibold">资料标题<input className={fieldClass} maxLength={80} value={draft.title} disabled={busy} onChange={/* event 更新条目标题。 */ event=>changeDraft({title:event.target.value})}/></label>
        <label className="space-y-1 text-xs font-semibold sm:col-span-2">FAQ 问题（可留空）<input className={fieldClass} maxLength={120} value={draft.question} disabled={busy} placeholder="例如：资料怎么使用？" onChange={/* event 更新匹配问题。 */ event=>changeDraft({question:event.target.value})}/></label>
        <label className="space-y-1 text-xs font-semibold sm:col-span-2">公开事实或答案<textarea className={fieldClass} rows={4} maxLength={600} value={draft.answer} disabled={busy} onChange={/* event 更新经过商家核对的公开知识。 */ event=>changeDraft({answer:event.target.value})}/></label>
      </div>
      <div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={putDraft}>{editIndex<0?'添加到草稿':'更新草稿'}</button>{editIndex>=0&&<button className={buttonClass} onClick={/* 取消本次条目编辑。 */ ()=>{setDraft(emptyEntry());setEditIndex(-1);}}>取消编辑</button>}</div>
      <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
        {config.entries.length===0&&<p className="p-4 text-sm text-gray-500">暂无资料，请先添加真实商品知识。</p>}
        {config.entries.map(/* entry、index 是当前已录入的知识草稿。 */ (entry,index)=><div key={index} className="flex flex-wrap items-center justify-between gap-2 p-3"><div className="min-w-0 flex-1"><p className="text-sm font-bold break-words">{entry.title} <span className="text-xs text-gray-500">{scopeName[entry.scope]} · {entry.question?'FAQ':'知识'} {entry.account_id} {entry.item_id}</span></p><p className="text-xs text-gray-500 break-words">{entry.question||entry.answer}</p></div><button className={buttonClass} disabled={busy} onClick={/* 编辑选中的原始草稿。 */ ()=>{setDraft({...entry});setEditIndex(index);}}>编辑</button><button className={buttonClass} disabled={busy} onClick={/* 删除待保存条目，不影响其他知识和已交付订单。 */ ()=>{setConfig({...config,entries:config.entries.filter(/* _,pos 保留非删除条目。 */ (_,pos)=>pos!==index)});setDraft(emptyEntry());setEditIndex(-1);}}>删除</button></div>)}
      </div>
    </section>}
    <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
      <h3 className="font-extrabold">客服模拟测试沙盒</h3><p className="text-xs leading-6 text-gray-500">使用已保存知识、当前账号 AI 策略和现有模型；不读取真实买家历史、不发送消息、不创建报价。非 FAQ 测试可能产生模型服务费用。请使用合成测试文本。</p>
      {!accountId&&<p className="text-sm text-gray-500">请在页面顶部选择一个店铺。</p>}
      <label className="text-xs font-semibold block space-y-1">测试商品（可不选）<select className={fieldClass} disabled={busy||!accountId} value={previewItem} onChange={/* event 切换沙盒商品并清空旧结果。 */ event=>{setPreviewItem(event.target.value);setResult(null);}}><option value="">无指定商品</option>{sandboxItems.map(/* item 是该店铺本地商品。 */ item=><option key={item.item_id} value={item.item_id}>{item.item_title||item.item_id}</option>)}</select></label>
      <label className="text-xs font-semibold block space-y-1">模拟买家问题<textarea className={fieldClass} maxLength={1000} rows={3} value={question} disabled={busy} onChange={/* event 编辑合成问题并隐藏此前预览。 */ event=>{setQuestion(event.target.value);setResult(null);}}/></label>
      <button className={buttonClass} disabled={busy||!config||dirty||!accountId||!question.trim()} onClick={runPreview}>运行模拟测试</button>
      {dirty&&<p className="text-xs text-gray-500">请先保存知识配置再测试。</p>}
      {result&&resultAccount===accountId&&<div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm space-y-2"><strong>{result.decision==='pass'?'质量规则通过':result.decision==='manual'?'拦截 / 需人工处理':'当前模式未匹配'} {result.source&&' · '+result.source}</strong><p className="whitespace-pre-wrap break-words">{result.reply||result.reason}</p><p className="text-xs text-gray-500">仅候选结果，不代表事实已被验证或消息已发送。</p></div>}
    </section>
    <section className="rounded-2xl bg-white border border-gray-200 p-5 space-y-3">
      <h3 className="font-extrabold">持久化人工接管（{visibleTakeovers.length}）</h3><p className="text-xs text-gray-500">接管记录跨重启保留。人工风险接管等待明确恢复；暂停仅影响此会话的自动回复，不改变交易自动化。手动接管可填写本地聊天会话 ID。</p>
      <div className="flex gap-2"><input aria-label="聊天会话 ID" className={fieldClass} disabled={busy||!accountId} maxLength={160} value={chatID} placeholder="聊天会话 ID" onChange={/* event 输入待接管的本地会话。 */ event=>setChatID(event.target.value)}/><button className={buttonClass} disabled={busy||!accountId||!chatID.trim()} onClick={/* 手动暂停当前店铺的指定会话。 */ ()=>changeTakeover(accountId,chatID,true)}>接管</button></div>
      {visibleTakeovers.length===0&&<p className="text-sm text-gray-500">没有生效中的接管记录。</p>}
      {visibleTakeovers.map(/* row 是一条有效的持久化接管。 */ row=><div key={row.account_id+'|'+row.chat_id} className="flex flex-wrap gap-3 items-center justify-between border-t pt-3"><div className="min-w-0"><p className="text-sm font-semibold break-words">{row.chat_id}</p><p className="text-xs text-gray-500">{row.account_id} · {reasonName[row.reason]||'人工接管'} · {row.until===-1?'等待人工恢复':new Date(row.until*1000).toLocaleString()}</p></div><button className={buttonClass} disabled={busy} onClick={/* 显式恢复选中的同一会话。 */ ()=>changeTakeover(row.account_id,row.chat_id,false)}>恢复自动回复</button></div>)}
    </section>
  </div>;
};

export default SupportCenter;
