// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SupportCenter, { movieKnowledge } from './components/SupportCenter';
import { readSupportWorkspace,saveSupportConfig,previewSupport,setSupportTakeover } from './api';
import type { AccountDetail } from './models';

vi.mock('./api', /* 本地替身只记录客服设置、只读沙盒及人工接管请求。 */ ()=>({
  readSupportWorkspace:vi.fn(),saveSupportConfig:vi.fn(),previewSupport:vi.fn(),setSupportTakeover:vi.fn(),
}));

// account 是不含凭证的本地账号测试夹具。
const account:AccountDetail={id:'account-1',enabled:true,auto_confirm:false};

describe('客服工作台', /* 验证知识保存、沙盒与人工接管的用户操作入口。 */ ()=>{
  afterEach(/* 卸载当前测试工作台，隔离后续组件状态。 */ ()=>cleanup());
  beforeEach(/* 重置模拟的本地持久化配置和接管记录。 */ ()=>{
    vi.clearAllMocks();
    vi.mocked(readSupportWorkspace).mockResolvedValue({config:{enabled:false,entries:[]},takeovers:[]});
    vi.mocked(saveSupportConfig).mockImplementation(/* config 模拟真实保存后的重新读取。 */ async config=>{
      vi.mocked(readSupportWorkspace).mockResolvedValue({config,takeovers:[]});
    });
    vi.mocked(setSupportTakeover).mockResolvedValue(undefined);
    vi.mocked(previewSupport).mockResolvedValue({decision:'manual',source:'',reply:'',reason:'需要人工确认'});
  });
  test('一次点击即保存知识并可运行无投递沙盒', /* 直接持久化成功后无需第二次提交草稿。 */ async ()=>{
    render(<SupportCenter accountId={account.id} accounts={[account]} items={[]}/>);
    await screen.findByText('三级知识库 / FAQ（0/60）');
    fireEvent.change(screen.getByLabelText('资料标题'),{target:{value:'教程'}});
    fireEvent.change(screen.getByLabelText('FAQ 问题（可留空）'),{target:{value:'怎么使用'}});
    fireEvent.change(screen.getByLabelText('公开事实或答案'),{target:{value:'请阅读使用说明'}});
    fireEvent.click(screen.getByText('保存并生效'));
    fireEvent.change(screen.getByLabelText('模拟买家问题'),{target:{value:'我要退款'}});
    await waitFor(/* 已保存配置必须来自用户草稿。 */ ()=>expect(saveSupportConfig).toHaveBeenCalledWith(expect.objectContaining({entries:[expect.objectContaining({question:'怎么使用',answer:'请阅读使用说明'})]}),expect.anything()));
    await screen.findByText('知识已保存并生效');
    expect((screen.getByLabelText('资料标题') as HTMLInputElement).value).toBe('');
    expect((screen.getByText('运行模拟测试') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('运行模拟测试'));
    expect(await screen.findByText('需要人工确认')).toBeTruthy();
    expect(previewSupport).toHaveBeenCalledWith('account-1','','我要退款',expect.anything());
  });
  test('一键电影知识直接写库且不得重复添加', /* 通用模板带高清中文字幕和双盘事实，保存后显示已添加。 */ async ()=>{
    render(<SupportCenter accountId={account.id} accounts={[account]} items={[]}/>);
    await screen.findByText('三级知识库 / FAQ（0/60）');
    fireEvent.click(screen.getByRole('button',{name:'一键保存电影知识'}));
    await waitFor(/* 一键按钮将商家确认事实完整保存到全局。 */ ()=>expect(saveSupportConfig).toHaveBeenCalledWith(expect.objectContaining({entries:[movieKnowledge]}),expect.anything()));
    expect(movieKnowledge.answer).toContain('中文字幕');
    expect(movieKnowledge.answer).toContain('高清');
    expect(movieKnowledge.answer).toContain('百度网盘和夸克网盘双盘发货');
    await screen.findByText('电影资源通用知识已保存并生效');
    expect((screen.getByRole('button',{name:'已添加电影知识'}) as HTMLButtonElement).disabled).toBe(true);
  });
  test('保存失败保留编辑内容且不伪装已保存', /* 用户可以纠正输入后重新保存，无须重填知识。 */ async ()=>{
    vi.mocked(saveSupportConfig).mockRejectedValueOnce(new Error('bad data'));
    render(<SupportCenter accountId={account.id} accounts={[account]} items={[]}/>);
    await screen.findByText('三级知识库 / FAQ（0/60）');
    fireEvent.change(screen.getByLabelText('资料标题'),{target:{value:'电影说明'}});
    fireEvent.change(screen.getByLabelText('公开事实或答案'),{target:{value:'网盘资源'}});
    fireEvent.click(screen.getByRole('button',{name:'保存并生效'}));
    await screen.findByText(/保存失败，请检查资料长度/);
    expect((screen.getByLabelText('资料标题') as HTMLInputElement).value).toBe('电影说明');
    expect(screen.getByText('三级知识库 / FAQ（0/60）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'保存并生效'}));
    await screen.findByText('知识已保存并生效');
  });
  test('编辑、开关变更和删除分别一次保存', /* 每个独立操作完成数据库写入并按重读结果刷新。 */ async ()=>{
    vi.mocked(readSupportWorkspace).mockResolvedValue({config:{enabled:false,entries:[{...movieKnowledge}]},takeovers:[]});
    // confirmSpy 模拟用户明确确认删除知识的浏览器弹窗。
    const confirmSpy=vi.spyOn(window,'confirm').mockReturnValue(true);
    try {
      render(<SupportCenter accountId={account.id} accounts={[account]} items={[]}/>);
      await screen.findByText('三级知识库 / FAQ（1/60）');
      fireEvent.click(screen.getByRole('button',{name:'编辑'}));
      fireEvent.change(screen.getByLabelText('公开事实或答案'),{target:{value:'已核实的电影网盘资源'}});
      fireEvent.click(screen.getByRole('button',{name:'保存修改'}));
      await screen.findByText('知识修改已保存');
      expect(saveSupportConfig).toHaveBeenLastCalledWith(expect.objectContaining({entries:[expect.objectContaining({answer:'已核实的电影网盘资源'})]}),expect.anything());
      fireEvent.click(screen.getByLabelText('启用受控客服（本人全部店铺）'));
      await screen.findByText('受控客服已启用');
      expect(saveSupportConfig).toHaveBeenLastCalledWith(expect.objectContaining({enabled:true}),expect.anything());
      fireEvent.click(screen.getByRole('button',{name:'删除'}));
      await screen.findByText('知识已删除');
      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(saveSupportConfig).toHaveBeenLastCalledWith(expect.objectContaining({entries:[]}),expect.anything());
    } finally { confirmSpy.mockRestore(); }
  });
  test('已接管会话可以明确恢复', /* 使用持久化记录对应的账号与会话发起恢复，不发送真实消息。 */ async ()=>{
    vi.mocked(readSupportWorkspace).mockResolvedValue({config:{enabled:true,entries:[]},takeovers:[{account_id:account.id,chat_id:'chat-1',until:-1,reason:'risk',updated_at:123}]});
    render(<SupportCenter accountId={account.id} accounts={[account]} items={[]}/>);
    fireEvent.click(await screen.findByText('恢复自动回复'));
    await waitFor(/* 恢复动作严格对应选中会话。 */ ()=>expect(setSupportTakeover).toHaveBeenCalledWith(account.id,'chat-1',false,expect.anything()));
  });
});
