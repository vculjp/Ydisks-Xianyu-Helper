import { useEffect, useRef, useState } from 'react';
import { addRadarTargets, clearRadarItems, deleteRadarTarget, loadRadar, saveRadarSchedule, startRadar, stopRadar, toggleRadarTarget, type RadarData, type RadarSort } from '../api';
import { collectorErrorMessage } from '../api';

/** RadarPanelProps 提供当前选中账号与人工进入详情采集的回调。 */
interface RadarPanelProps {
  /** cookieId 是非敏感的当前采集账号标识。 */
  cookieId: string;
  /** onInspect 仅将榜单商品 ID 带入详情采集表单，不自动发起平台请求。 */
  onInspect: (id: string) => void;
}

/** buttonStyle 统一雷达本地操作按钮样式。 */
const buttonStyle = 'rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-40';
/** inputStyle 统一监控项与定时配置输入样式。 */
const inputStyle = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';

/** RadarPanel 提供本地榜单、监控池、显式巡检及低频计划；离开页面会取消本地请求，但不取消已启动的后端任务。 */
export function RadarPanel({ cookieId, onInspect }: RadarPanelProps) {
  // data 保存最近一次本地接口读取的完整雷达数据。
  const [data, setData] = useState<RadarData | null>(null);
  // type、value、days 分别是待添加目标类型、输入文本及新发天数。
  const [type, setType] = useState<'keyword' | 'seller'>('keyword');
  // value 与 setValue 保存未提交的监控目标文本。
  const [value, setValue] = useState('');
  const [days, setDays] = useState(3);
  // interval 是用户将要保存的定时间隔，未保存时不改动后台。
  const [interval, setIntervalHours] = useState(12);
  // sort 控制本地已存快照排序。
  const [sort, setSort] = useState<RadarSort>('score');
  // refresh 每次修改后递增，作废旧读取并重新加载数据。
  const [refresh, setRefresh] = useState(0);
  // busy 防止本页面重复提交操作，message 保存可见错误。
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // actionRef 持有当前写请求的取消句柄，离开面板后释放。
  const actionRef = useRef<AbortController | null>(null);
  // loadedSchedule 标记初次读取已同步定时间隔，轮询不覆盖用户正在编辑的表单。
  const loadedSchedule = useRef(false);

  useEffect(/* reloadEffect 在排序、手动刷新或操作成功后重新读取本地数据；不发起外部采集。 */ () => {
    // controller 控制本轮读取以及后续状态轮询的生命周期。
    const controller = new AbortController();
    // timer 是上一轮读取结束后安排的本地轮询，不允许重叠请求。
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** poll 读取本地榜单和扫描进度，成功后按运行状态决定下一次间隔。 */
    const poll = async (): Promise<void> => {
      // delay 是空闲时的本地状态刷新间隔，不涉及平台访问。
      let delay = 30_000;
      try {
        // next 包含本轮非敏感的本地雷达数据。
        const next = await loadRadar(sort, controller.signal);
        if (controller.signal.aborted) return;
        setData(next);
        if (!loadedSchedule.current) {
          loadedSchedule.current = true;
          setIntervalHours([6,12,24].includes(next.status.schedule.interval) ? next.status.schedule.interval : 12);
        }
        delay = next.status.running ? 5_000 : 30_000;
      } catch (failure /* failure 是本地数据读取异常，取消请求无需提示。 */) {
        if (!controller.signal.aborted) setMessage(collectorErrorMessage(failure, '读取雷达数据失败'));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, delay);
      }
    };
    void poll();
    return /* cleanup 作废旧轮询和未完成的读取。 */ () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [sort, refresh]);

  useEffect(/* unmountEffect 释放尚未完成的面板写请求。 */ () => () => {
    actionRef.current?.abort();
  }, []);

  /** perform 串行提交一次明确的用户操作，成功后触发本地刷新；失败不自动重试。 */
  const perform = async (operation: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    if (actionRef.current) return;
    // controller 持有本次写请求的独立取消信号。
    const controller = new AbortController();
    actionRef.current = controller;
    setBusy(true);
    setMessage('');
    try {
      await operation(controller.signal);
      if (!controller.signal.aborted) setRefresh(/* n 是已完成的数据刷新代次。 */ n => n + 1);
    } catch (failure /* failure 表示本次用户操作的错误。 */) {
      if (!controller.signal.aborted) setMessage(collectorErrorMessage(failure, '操作失败'));
    } finally {
      if (actionRef.current === controller) actionRef.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  // status 是最近一次服务端已确认的任务状态。
  const status = data?.status;
  // running 表示后端巡检仍在进行，需要禁用修改监控池和清空记录。
  const running = Boolean(status?.running);

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="font-bold text-slate-800">爆款雷达 · 样本监控</h3><p className="text-xs text-slate-500">每个目标仅观测第一页，累计日均想要不等于近期增速。首次观测不计新增量。</p></div>
          <div className="flex gap-2">
            <button className={buttonStyle} disabled={busy} onClick={/* 只刷新已落库的雷达数据。 */ () => setRefresh(/* n 是刷新代次。 */ n => n + 1)}>刷新</button>
            <button className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white disabled:opacity-40" disabled={busy || running || !cookieId || !data?.targets.some(/* target 是候选启用目标。 */ target => target.enabled)} onClick={/* signal 仅控制创建任务请求。 */ () => void perform(/* signal 控制请求取消。 */ signal => startRadar(cookieId, signal))}>启动巡检</button>
            <button className={buttonStyle} disabled={busy || !running} onClick={/* 用户主动停止当前巡检。 */ () => void perform(stopRadar)}>停止</button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-4 text-sm">
          <div className="rounded-lg bg-slate-50 p-3">任务：{running ? '运行中' : '空闲'}</div>
          <div className="rounded-lg bg-slate-50 p-3">进度：{status?.completed ?? 0}/{status?.total ?? 0}</div>
          <div className="rounded-lg bg-slate-50 p-3">已更新：{status?.updated ?? 0}</div>
          <div className="rounded-lg bg-slate-50 p-3">异动：{status?.rising ?? 0}</div>
        </div>
        {running && <p className="text-sm text-slate-600">当前目标：{status?.currentTarget}</p>}
        {status?.error && <p role="alert" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{status.aborted ? '巡检已安全停止：' : ''}{status.error}</p>}
        {message && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{message}</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
          <span>自动巡检：{status?.schedule.enabled ? `已开启（每 ${status.schedule.interval} 小时，账号 ${status.schedule.cookieId}）` : '已关闭'}</span>
          <select aria-label="巡检周期" className={inputStyle} value={interval} onChange={/* event 更新尚未保存的低频周期。 */ event => setIntervalHours(Number(event.target.value))}><option value={6}>6 小时</option><option value={12}>12 小时</option><option value={24}>24 小时</option></select>
          <button className={buttonStyle} disabled={busy || !cookieId || running} onClick={/* 计划须由用户明确确认授权和账号状态；异常后不会自动恢复。 */ () => { if (window.confirm('请确认已通过官方渠道核对账号状态，并具备相应操作授权。确定保存此定时计划？')) void perform(/* signal 控制定时写入。 */ signal => saveRadarSchedule(true, cookieId, interval, signal)); }}>开启 / 保存计划</button>
          <button className={buttonStyle} disabled={busy || !status?.schedule.enabled} onClick={/* 用户明确关闭未来自动巡检。 */ () => void perform(/* signal 控制关闭计划请求。 */ signal => saveRadarSchedule(false, status?.schedule.cookieId ?? '', interval, signal))}>关闭计划</button>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="font-bold text-slate-800">监控池（{data?.targets.length ?? 0}/50）</h3>
        <div className="flex flex-wrap gap-2">
          <select aria-label="监控类型" className={inputStyle} value={type} onChange={/* event 更新目标录入模式。 */ event => setType(event.target.value as 'keyword' | 'seller')}><option value="keyword">关键词</option><option value="seller">同行卖家</option></select>
          <input aria-label="监控目标" placeholder={type === 'keyword' ? '输入关键词' : '同行主页链接或卖家 ID'} className={`${inputStyle} min-w-48 flex-1`} value={value} onChange={/* event 更新待保存文本。 */ event => setValue(event.target.value)} />
          {type === 'keyword' && <select aria-label="新发范围" className={inputStyle} value={days} onChange={/* event 更新关键词新发天数。 */ event => setDays(Number(event.target.value))}><option value={0}>不限</option><option value={1}>1天</option><option value={3}>3天</option><option value={7}>7天</option><option value={14}>14天</option></select>}
          <button className={buttonStyle} disabled={busy || running || !value.trim()} onClick={/* 用户提交新增目标。 */ () => void perform(/* signal 控制目标写入。 */ async signal => { await addRadarTargets(type, value.trim(), days, false, signal); if (!signal.aborted) setValue(''); })}>添加目标</button>
          <button className={buttonStyle} disabled={busy || running} onClick={/* 导入内置词包前不会触发采集。 */ () => void perform(/* signal 控制词包写入。 */ signal => addRadarTargets('keyword', '', 3, true, signal))}>导入虚拟资料种子词</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {data?.targets.map(/* target 是单条本地监控配置。 */ target => <div key={target.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-xs">
            <span className={target.enabled ? 'text-slate-800' : 'text-slate-400'}>{target.label || target.value} · {target.lastHitCount} 件</span>
            <button className={buttonStyle} disabled={busy || running} onClick={/* 修改当前目标开关。 */ () => void perform(/* signal 控制开关修改。 */ signal => toggleRadarTarget(target.id, !target.enabled, signal))}>{target.enabled ? '暂停' : '启用'}</button>
            <button className={buttonStyle} disabled={busy || running} onClick={/* 删除前要求用户明确确认。 */ () => { if (window.confirm('删除该监控目标？')) void perform(/* signal 控制删除请求。 */ signal => deleteRadarTarget(target.id, signal)); }}>删除</button>
          </div>)}
          {data?.targets.length === 0 && <p className="text-sm text-slate-500">暂无监控目标，请先添加关键词或同行。</p>}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h3 className="font-bold text-slate-800">热度榜单（最多 200 条）</h3>
          <div className="flex gap-2">
            <select aria-label="榜单排序" className={inputStyle} value={sort} onChange={/* event 选择本地榜单排序。 */ event => setSort(event.target.value as RadarSort)}><option value="score">综合评分</option><option value="delta">新增想要</option><option value="velocity">累计日均想要</option><option value="seller_new">同行榜单</option></select>
            <button className={buttonStyle} disabled={busy || running || !data?.items.length} onClick={/* 清理本地历史快照需二次确认。 */ () => { if (window.confirm('确认清空全部雷达商品快照？')) void perform(clearRadarItems); }}>清空榜单</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">商品</th><th>售价</th><th>累计想要</th><th>观测增量</th><th>日均</th><th>评分</th><th>来源</th><th>操作</th></tr></thead>
            <tbody>{data?.items.map(/* item 是一条最近观测快照。 */ item => <tr key={item.id} className="border-t border-slate-100">
              <td className="p-2 max-w-64"><div className="flex items-center gap-2">{item.image && <img className="h-10 w-10 rounded object-cover" src={item.image} alt="" loading="lazy" />}<a className="font-semibold text-slate-800 hover:text-brand" href={item.url} target="_blank" rel="noreferrer">{item.title}</a></div></td>
              <td>{item.price || '未知'}</td><td>{item.wants}</td><td>+{item.delta}</td><td>{item.velocity.toFixed(2)}</td><td>{item.score}</td><td>{item.source}</td>
              <td><button className={buttonStyle} onClick={/* 将商品 ID 带入单品详情采集表单。 */ () => onInspect(item.id)}>详情采集</button></td>
            </tr>)}</tbody>
          </table>
          {!data?.items.length && <p className="p-8 text-center text-sm text-slate-500">暂无榜单观测记录。</p>}
        </div>
      </div>
    </section>
  );
}
