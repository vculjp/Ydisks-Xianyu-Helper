// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Item } from '../models';
import ItemEditorPage, { type ItemEditorPageProps } from './ItemEditorPage';

/** savedItem 是组件边界的确定性商品夹具，长标题用于防止参考页面的 30 字限制侵入存量编辑。 */
const savedItem: Item = {
  id: 'local-7',
  cookie_id: 'shop-3',
  item_id: 'item-7',
  item_title: '这是已经保存的超过三十个汉字的真实商品标题需要在新版编辑页面完整保留',
  item_description: '原始商品描述',
  item_category: '资料',
  item_price: '12.50',
  item_image: 'https://example.test/product.png',
};

/** editorProps 为每个测试提供独立的受控草稿与回调，overrides 仅覆盖本用例关心的父级输入。 */
function editorProps(overrides: Partial<ItemEditorPageProps> = {}): ItemEditorPageProps {
  return {
    item: savedItem,
    draft: { ...savedItem },
    accountName: '资料小店',
    busy: false,
    onChange: vi.fn(),
    onBack: vi.fn(),
    onSaveLocal: vi.fn(),
    onSaveRemote: vi.fn(),
    ...overrides,
  };
}

/** deferredSave 提供父级请求的可控完成与拒绝边界，不模拟组件内部实现。 */
function deferredSave() {
  /** resolve 在测试断言等待态之后结束真实 Promise；reject 模拟父级回调抛错。 */
  let resolve!: () => void;
  /** reject 携带不含账号秘密的保存失败说明。 */
  let reject!: (reason: Error) => void;
  /** promise 模拟尚未完成的本地或平台保存回调。 */
  const promise = new Promise<void>(/* accept/rejectRequest 是 Promise 提供的两个完成通知。 */ (accept, rejectRequest) => {
    resolve = accept;
    reject = rejectRequest;
  });
  return { promise, resolve, reject };
}

afterEach(/* 清理上一用例的表单，避免标签和按钮跨用例重复。 */ () => cleanup());

describe('ItemEditorPage', /* 通过 props 与可访问 DOM 验证独立页面的真实展示及操作。 */ () => {
  test('内嵌展示商品信息并完整保留长标题、真实图片与所属店铺', /* 首个用例先证明组件缺失，再驱动独立页面实现。 */ () => {
    render(<ItemEditorPage {...editorProps()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: '编辑商品', level: 1 })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '商品信息' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('宝贝标题') as HTMLInputElement).value).toBe(savedItem.item_title);
    expect((screen.getByLabelText('宝贝标题') as HTMLInputElement).maxLength).toBe(-1);
    expect((screen.getByLabelText('宝贝描述') as HTMLTextAreaElement).value).toBe('原始商品描述');
    expect((screen.getByLabelText('商品分类') as HTMLInputElement).value).toBe('资料');
    expect((screen.getByLabelText('售价') as HTMLInputElement).value).toBe('12.50');
    expect(screen.getByRole('img', { name: '商品主图预览' }).getAttribute('src')).toBe(savedItem.item_image);
    expect((screen.getByLabelText('所属店铺') as HTMLInputElement).value).toBe('资料小店');
    expect((screen.getByLabelText('所属店铺') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: /上传|图库/ })).toBeNull();
    expect((screen.getByLabelText('商品分类').compareDocumentPosition(screen.getByLabelText('定位城市')) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
    expect((screen.getByLabelText('所属店铺').compareDocumentPosition(screen.getByLabelText('商品规格')) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });

  test.each([
    ['201221406', '电影票'],
    ['50114004', '女士半身裙'],
    ['50023914', '电子资料'],
    ['99999999', '99999999'],
  ])('类目 ID %s 显示为已核实名称或保留未知 ID', /* rawCategory/expected 对应平台真实类目和未知回退值。 */ (rawCategory, expected) => {
    render(<ItemEditorPage {...editorProps({ item: { ...savedItem, item_category: rawCategory }, draft: { item_category: rawCategory } })} />);
    expect((screen.getByLabelText('商品分类') as HTMLInputElement).value).toBe(expected);
  });

  test.each(['仅保存本地', '同步修改到闲鱼'])('等待 %s 回调完成，禁用返回和字段并拦截交叉重复提交', /* actionName 是本次要验证的真实保存动作。 */ async actionName => {
    /** request 在完成前保持父级请求挂起；props 提供可核对调用次数的边界回调。 */
    const request = deferredSave();
    /** props 按动作名称仅为对应回调设置延迟 Promise。 */
    const props = editorProps({
      draft: { ...savedItem, item_title: '修改后的商品标题' },
      ...(actionName === '仅保存本地'
        ? { onSaveLocal: vi.fn(/* 返回本地保存的在途请求。 */ () => request.promise) }
        : { onSaveRemote: vi.fn(/* 返回平台保存的在途请求。 */ () => request.promise) }),
    });
    render(<ItemEditorPage {...props} />);
    fireEvent.click(screen.getByRole('button', { name: actionName }));
    expect(screen.getByRole('status').textContent).toContain('正在处理');
    expect((screen.getByRole('button', { name: '返回商品列表' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('宝贝标题') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('宝贝描述') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByLabelText('商品分类') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('所属店铺') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('售价') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '返回商品列表' }));
    fireEvent.click(screen.getByRole('button', { name: '仅保存本地' }));
    fireEvent.click(screen.getByRole('button', { name: '同步修改到闲鱼' }));
    fireEvent.submit(screen.getByRole('tabpanel'));
    fireEvent.change(screen.getByLabelText('宝贝标题'), { target: { value: '在途变更' } });
    expect(props.onBack).not.toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onSaveLocal).toHaveBeenCalledTimes(actionName === '仅保存本地' ? 1 : 0);
    expect(props.onSaveRemote).toHaveBeenCalledTimes(actionName === '同步修改到闲鱼' ? 1 : 0);
    await act(/* 结束父级请求并等待页面释放提交锁。 */ async () => request.resolve());
    await waitFor(/* 两个动作完成后均恢复本地保存入口。 */ () => expect((screen.getByRole('button', { name: '仅保存本地' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '返回商品列表' }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  test.each(['仅保存本地', '同步修改到闲鱼'])('%s 抛错时显示原因、保留草稿并允许重试', /* actionName 区分两种父级异步保存错误。 */ async actionName => {
    /** callback 首次失败、第二次成功，证明组件不会自动重试或自动返回。 */
    const callback = vi.fn().mockRejectedValueOnce(new Error('保存连接中断')).mockResolvedValueOnce(undefined);
    /** props 携带用户改动和指定失败的保存入口。 */
    const props = editorProps({
      draft: { ...savedItem, item_title: '未保存的真实修改' },
      ...(actionName === '仅保存本地' ? { onSaveLocal: callback } : { onSaveRemote: callback }),
    });
    render(<ItemEditorPage {...props} />);
    fireEvent.click(screen.getByRole('button', { name: actionName }));
    await waitFor(/* 等待父级抛错显示到当前表单。 */ () => expect(screen.getByRole('alert').textContent).toBe('保存连接中断'));
    expect((screen.getByLabelText('宝贝标题') as HTMLInputElement).value).toBe('未保存的真实修改');
    expect(props.onBack).not.toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: actionName }));
    await waitFor(/* 手动重试成功后清除失败提示。 */ () => expect(screen.queryByRole('alert')).toBeNull());
    expect(callback).toHaveBeenCalledTimes(2);
  });

  test('补全定位、规格、库存、运费的只读行，未知值不使用假默认值', /* 未返回的扩展信息只能准确显示未获取。 */ () => {
    render(<ItemEditorPage {...editorProps()} />);
    expect((screen.getByLabelText('定位城市') as HTMLInputElement).value).toBe('未获取');
    expect((screen.getByLabelText('库存') as HTMLInputElement).value).toBe('未获取');
    expect(within(screen.getByRole('radiogroup', { name: '商品规格' })).queryByRole('radio', { checked: true })).toBeNull();
    expect(within(screen.getByRole('radiogroup', { name: '运费设置' })).queryByRole('radio', { checked: true })).toBeNull();
    expect((screen.getByLabelText('库存') as HTMLInputElement).readOnly).toBe(true);
    expect(within(screen.getByRole('radiogroup', { name: '商品规格' })).getByRole('radio', { name: '单规格' })).toBeTruthy();
  });

  test('只读行展示已有值且保留零库存，不从草稿伪造扩展字段', /* item_detail 的明确字段仅供预览，不可经表单修改。 */ () => {
    /** item 提供模型中明确的多规格标记和已记录的根级扩展字段。 */
    const item: Item = {
      ...savedItem,
      is_multi_spec: true,
      item_detail: JSON.stringify({ quantity: 0, location: { province: '浙江省', city: '杭州市', area: '西湖区' }, postage_mode: 'fixed', postage: '6.00' }),
    };
    render(<ItemEditorPage {...editorProps({ item, draft: { ...item, item_detail: '{}' } })} />);
    expect((screen.getByLabelText('定位城市') as HTMLInputElement).value).toBe('浙江省 / 杭州市 / 西湖区');
    expect((within(screen.getByRole('radiogroup', { name: '商品规格' })).getByRole('radio', { name: '多规格' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('库存') as HTMLInputElement).value).toBe('0');
    expect((within(screen.getByRole('radiogroup', { name: '运费设置' })).getByRole('radio', { name: '固定邮费 固定邮费：6.00 元' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('当前编辑接口不支持修改库存。')).toBeTruthy();
  });

  test('只读单选组拒绝鼠标与方向键改变平台保存值', /* 只读外观必须与真实交互语义一致。 */ () => {
    /** item 明确保存了多规格，用来验证切换到单规格不会生效。 */
    const item: Item = { ...savedItem, is_multi_spec: true };
    render(<ItemEditorPage {...editorProps({ item, draft: { ...item } })} />);
    /** specs 是当前商品的只读规格选项组。 */
    const specs = screen.getByRole('radiogroup', { name: '商品规格' });
    /** single 是未选中的单规格原生输入。 */
    const single = within(specs).getByRole('radio', { name: '单规格' }) as HTMLInputElement;
    /** multiple 是平台已保存的多规格选项。 */
    const multiple = within(specs).getByRole('radio', { name: '多规格' }) as HTMLInputElement;
    fireEvent.click(single);
    fireEvent.keyDown(single, { key: 'ArrowLeft' });
    expect(single.checked).toBe(false);
    expect(multiple.checked).toBe(true);
  });

  test.each(['宝贝标题', '宝贝描述', '商品分类', '售价'])('修改 %s 只通过 onChange 合并对应真实字段', /* label 对应页面唯一可编辑的四个字段之一。 */ label => {
    /** fields 是可访问标签与可保存模型字段的明确对应关系。 */
    const fields = { 宝贝标题: 'item_title', 宝贝描述: 'item_description', 商品分类: 'item_category', 售价: 'item_price' } as const;
    /** props 为测试保留其他草稿字段提供独立回调。 */
    const props = editorProps();
    render(<ItemEditorPage {...props} />);
    fireEvent.change(screen.getByLabelText(label), { target: { value: '用户输入' } });
    expect(props.onChange).toHaveBeenCalledWith({ ...savedItem, [fields[label as keyof typeof fields]]: '用户输入' });
    expect(props.onSaveLocal).not.toHaveBeenCalled();
    expect(props.onSaveRemote).not.toHaveBeenCalled();
  });

  test.each(['¥3', '￥3', '¥ 3.00'])('旧标题超过30字且售价为 %s 时仍可保存原始草稿', /* existingPrice 必须原样保留，不能因显示或校验产生价格变更。 */ async existingPrice => {
    /** item 是价格含货币符号、标题超长的真实存量形态。 */
    const item: Item = { ...savedItem, item_price: existingPrice };
    /** props 仅修改描述，验证远端不因未改的价格或长标题而被阻断。 */
    const props = editorProps({ item, draft: { ...item, item_description: '只更新描述' } });
    render(<ItemEditorPage {...props} />);
    fireEvent.submit(screen.getByRole('tabpanel'));
    await waitFor(/* 等待默认表单提交完成，键盘提交与本地按钮共用此入口。 */ () => expect((screen.getByRole('button', { name: '仅保存本地' }) as HTMLButtonElement).disabled).toBe(false));
    expect(props.onSaveLocal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '同步修改到闲鱼' }));
    await waitFor(/* 等待远端回调完成后检查原始值。 */ () => expect((screen.getByRole('button', { name: '同步修改到闲鱼' }) as HTMLButtonElement).disabled).toBe(false));
    expect(props.onSaveRemote).toHaveBeenCalledTimes(1);
    expect(props.onChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText('售价') as HTMLInputElement).value).toBe(existingPrice);
    expect((screen.getByLabelText('宝贝标题') as HTMLInputElement).value).toBe(savedItem.item_title);
  });

  test.each([
    ['item_title', '  ', '宝贝标题'],
    ['item_description', '', '宝贝描述'],
    ['item_price', '0', '售价'],
    ['item_price', '1e2', '售价'],
    ['item_price', '3.123', '售价'],
    ['item_price', '不议价', '售价'],
    ['item_price', '-1', '售价'],
    ['item_price', '9000000000000001', '售价'],
  ])('远端仅校验实际变更的 %s=%s，本地兼容保存仍可继续', /* field/value/label 是无效远端补丁及其可访问字段。 */ async (field, value, label) => {
    /** props 只改当前无效字段，不影响其他历史字段的可保存边界。 */
    const props = editorProps({ draft: { ...savedItem, [field]: value } });
    render(<ItemEditorPage {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '同步修改到闲鱼' }));
    expect(props.onSaveRemote).not.toHaveBeenCalled();
    expect(screen.getByLabelText(label).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain(label);
    fireEvent.click(screen.getByRole('button', { name: '仅保存本地' }));
    await waitFor(/* 本地兼容路径没有新增非空、金额或字数限制。 */ () => expect(props.onSaveLocal).toHaveBeenCalledTimes(1));
  });

  test.each(['¥3', '￥3.01', '+3', '0.01', '9000000000000000.99'])('实际修改售价为 %s 时按既有远端金额边界允许提交', /* price 是可接受的原始价格文本，不应被表单归一后回写。 */ async price => {
    /** props 保留原金额，只通过 draft 提供本次有效改价。 */
    const props = editorProps({ draft: { ...savedItem, item_price: price } });
    render(<ItemEditorPage {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '同步修改到闲鱼' }));
    await waitFor(/* 有效价格只委托父级执行一次真实回调。 */ () => expect(props.onSaveRemote).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText('售价') as HTMLInputElement).value).toBe(price);
  });

  test.each(['{损坏的JSON', 'null', '[]', '"文本"', '123'])('损坏或非对象详情 %s 保持未知只读状态', /* rawDetail 覆盖解析失败和不能作为商品字段对象的 JSON。 */ rawDetail => {
    render(<ItemEditorPage {...editorProps({ item: { ...savedItem, item_detail: rawDetail, item_image: undefined }, draft: {} })} />);
    expect((screen.getByLabelText('库存') as HTMLInputElement).value).toBe('未获取');
    expect((screen.getByLabelText('定位城市') as HTMLInputElement).value).toBe('未获取');
    expect(within(screen.getByRole('radiogroup', { name: '运费设置' })).queryByRole('radio', { checked: true })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('暂无商品主图')).toBeTruthy();
  });

  test.each([
    [{ quantity: '8', location: '杭州', postage_mode: 'free' }, '8', '杭州', '包邮'],
    [{ quantity: -1, location: [], postage_mode: 'none' }, '未获取', '未获取', '无需邮寄'],
    [{ quantity: 1.2, location: {}, postage_mode: 'distance' }, '未获取', '未获取', '按距离计费'],
    [{ quantity: {}, location: '', postage_mode: 'fixed' }, '未获取', '未获取', '固定邮费（金额未获取）'],
    [{ quantity: '未知', location: 5, postage_mode: 'fixed', postage: 0 }, '未获取', '未获取', '固定邮费：0 元'],
  ])('只读预览按明确原值展示且不猜测缺失数据：%j', /* detail/quantity/location/postage 描述保存数据及独立预期文案。 */ (detail, quantity, location, postage) => {
    render(<ItemEditorPage {...editorProps({ item: { ...savedItem, item_detail: JSON.stringify(detail) } })} />);
    expect((screen.getByLabelText('库存') as HTMLInputElement).value).toBe(quantity);
    expect((screen.getByLabelText('定位城市') as HTMLInputElement).value).toBe(location);
    /** postageGroup 是当前用例的只读运费选项组。 */
    const postageGroup = screen.getByRole('radiogroup', { name: '运费设置' });
    /** selectedPostage 是平台明确保存后应保持选中的运费选项。 */
    const selectedPostage = within(postageGroup).queryByRole('radio', { checked: true });
    expect(selectedPostage?.getAttribute('value')).toBe(
      postage === '包邮' ? 'free' : postage === '无需邮寄' ? 'none' : postage === '按距离计费' ? 'distance' : 'fixed',
    );
    if (selectedPostage?.getAttribute('value') === 'fixed') expect(postageGroup.textContent).toContain(postage);
  });

  test.each([false, 0, true, 1] as const)('仅依据明确规格标记 %s 展示只读规格', /* flag 是 Item 模型已经提供的布尔或数字标记。 */ flag => {
    render(<ItemEditorPage {...editorProps({ item: { ...savedItem, is_multi_spec: flag } })} />);
    /** expected 是由明确规格标记推导出的唯一选中项。 */
    const expected = flag === false || flag === 0 ? '单规格' : '多规格';
    expect((within(screen.getByRole('radiogroup', { name: '商品规格' })).getByRole('radio', { name: expected }) as HTMLInputElement).checked).toBe(true);
  });

  test('显式清空值不回退成存量数据，字符计数按 Unicode 显示', /* 父级 Partial 草稿中的空字符串也是有效用户输入。 */ () => {
    render(<ItemEditorPage {...editorProps({ draft: { item_title: '😀a', item_description: '', item_category: '', item_price: '' }, accountName: '' })} />);
    expect(screen.getByText('2', { selector: '.editor-count > span' })).toBeTruthy();
    expect((screen.getByLabelText('宝贝描述') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText('商品分类') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('售价') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('所属店铺') as HTMLInputElement).value).toBe('shop-3');
  });

  test('父级 busy 独立禁用全部入口；解除后可正常返回且移除离开保护', /* busy 不依赖组件是否启动过自己的请求。 */ () => {
    /** props 提供父级在途状态与导航断言。 */
    const props = editorProps({ busy: true });
    /** rerender 模拟主 Agent 释放父级的请求占用。 */
    const { rerender } = render(<ItemEditorPage {...props} />);
    fireEvent.submit(screen.getByRole('tabpanel'));
    fireEvent.click(screen.getByRole('button', { name: '同步修改到闲鱼' }));
    expect(props.onSaveLocal).not.toHaveBeenCalled();
    expect(props.onSaveRemote).not.toHaveBeenCalled();
    /** leaving 是可取消的浏览器关闭事件，用于检查在途导航保护。 */
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    rerender(<ItemEditorPage {...props} busy={false} />);
    /** released 是在请求完成后创建的离开事件，不应继续被旧监听阻止。 */
    const released = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(released);
    expect(released.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '返回商品列表' }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  test('切换商品后旧保存的失败不会覆盖新商品状态', /* 父级切换明确商品身份时，旧请求只属于旧表单。 */ async () => {
    /** request 模拟旧商品尚未结束的本地保存。 */
    const request = deferredSave();
    /** props 提供原商品与其在途保存回调。 */
    const props = editorProps({ onSaveLocal: vi.fn(/* 挂起旧商品的本地保存。 */ () => request.promise) });
    /** rerender 用同一组件位置切换账号，覆盖相同 item_id 的跨店铺隔离。 */
    const { rerender } = render(<ItemEditorPage {...props} />);
    fireEvent.submit(screen.getByRole('tabpanel'));
    rerender(<ItemEditorPage {...editorProps({ item: { ...savedItem, cookie_id: 'shop-other' }, draft: { item_title: '另一店铺商品' } })} />);
    await act(/* 旧请求现在失败，新商品不能出现旧商品的错误。 */ async () => request.reject(new Error('旧商品保存失败')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByLabelText('宝贝标题') as HTMLInputElement).value).toBe('另一店铺商品');
    expect((screen.getByRole('button', { name: '返回商品列表' }) as HTMLButtonElement).disabled).toBe(false);
  });

  test('同一轮事件中的重复表单提交只调用一次保存', /* 同步锁不能只依赖 React 完成重新渲染后的 disabled。 */ async () => {
    /** request 持有本轮唯一允许执行的保存。 */
    const request = deferredSave();
    /** props 提供可断言调用次数的本地保存回调。 */
    const props = editorProps({ onSaveLocal: vi.fn(/* 返回本轮尚未完成的保存。 */ () => request.promise) });
    render(<ItemEditorPage {...props} />);
    act(/* 将多个提交事件放在同一轮 React 更新中，检查渲染前的防重入。 */ () => {
      fireEvent.submit(screen.getByRole('tabpanel'));
      fireEvent.submit(screen.getByRole('tabpanel'));
      fireEvent.click(screen.getByRole('button', { name: '同步修改到闲鱼' }));
    });
    expect(props.onSaveLocal).toHaveBeenCalledTimes(1);
    expect(props.onSaveRemote).not.toHaveBeenCalled();
    await act(/* 结束唯一请求，避免测试结束时留下未释放状态。 */ async () => request.resolve());
  });

  test('本地回调完成后父级仍 busy 时继续禁止返回', /* internalSaving 和 busy 互不覆盖，必须同时结束才解锁。 */ async () => {
    /** request 可独立于父级 busy 状态结束。 */
    const request = deferredSave();
    /** props 让本地保存进入内部等待状态。 */
    const props = editorProps({ onSaveLocal: vi.fn(/* 等待测试主动结束父级回调。 */ () => request.promise) });
    /** rerender 模拟父级的另一个在途请求。 */
    const { rerender } = render(<ItemEditorPage {...props} />);
    fireEvent.submit(screen.getByRole('tabpanel'));
    rerender(<ItemEditorPage {...props} busy />);
    await act(/* 本地请求结束时不能清除父级仍持有的 busy。 */ async () => request.resolve());
    expect((screen.getByRole('button', { name: '返回商品列表' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ItemEditorPage {...props} busy={false} />);
    expect((screen.getByRole('button', { name: '返回商品列表' }) as HTMLButtonElement).disabled).toBe(false);
  });

  test.each([undefined, '未知拒绝值', new Error('')])('回调拒绝值 %s 无有效说明时显示可见通用错误', /* rejection 可能来自不符合 Error 约定的父级实现。 */ async rejection => {
    render(<ItemEditorPage {...editorProps({ onSaveLocal: vi.fn().mockRejectedValueOnce(rejection) })} />);
    fireEvent.submit(screen.getByRole('tabpanel'));
    await waitFor(/* 通用错误仍需可见且不得吞掉失败反馈。 */ () => expect(screen.getByRole('alert').textContent).toBe('保存失败，请重试。'));
    expect((screen.getByLabelText('宝贝标题') as HTMLInputElement).value).toBe(savedItem.item_title);
  });
});
