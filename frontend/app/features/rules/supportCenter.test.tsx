// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SupportCenter from './components/SupportCenter';
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
  test('保存知识后才可运行无投递沙盒', /* 草稿未保存时不得调用已保存知识沙盒。 */ async ()=>{
    render(<SupportCenter accountId={account.id} accounts={[account]} items={[]}/>);
    await screen.findByText('三级知识库 / FAQ（0/60）');
    fireEvent.change(screen.getByLabelText('资料标题'),{target:{value:'教程'}});
    fireEvent.change(screen.getByLabelText('FAQ 问题（可留空）'),{target:{value:'怎么使用'}});
    fireEvent.change(screen.getByLabelText('公开事实或答案'),{target:{value:'请阅读使用说明'}});
    fireEvent.click(screen.getByText('添加到草稿'));
    fireEvent.change(screen.getByLabelText('模拟买家问题'),{target:{value:'我要退款'}});
    expect((screen.getByText('运行模拟测试') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('保存知识配置'));
    await waitFor(/* 已保存配置必须来自用户草稿。 */ ()=>expect(saveSupportConfig).toHaveBeenCalledWith(expect.objectContaining({entries:[expect.objectContaining({question:'怎么使用',answer:'请阅读使用说明'})]}),expect.anything()));
    await waitFor(/* 已完成保存与重读后沙盒可运行。 */ ()=>expect((screen.getByText('运行模拟测试') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('运行模拟测试'));
    expect(await screen.findByText('需要人工确认')).toBeTruthy();
    expect(previewSupport).toHaveBeenCalledWith('account-1','','我要退款',expect.anything());
  });
  test('已接管会话可以明确恢复', /* 使用持久化记录对应的账号与会话发起恢复，不发送真实消息。 */ async ()=>{
    vi.mocked(readSupportWorkspace).mockResolvedValue({config:{enabled:true,entries:[]},takeovers:[{account_id:account.id,chat_id:'chat-1',until:-1,reason:'risk',updated_at:123}]});
    render(<SupportCenter accountId={account.id} accounts={[account]} items={[]}/>);
    fireEvent.click(await screen.findByText('恢复自动回复'));
    await waitFor(/* 恢复动作严格对应选中会话。 */ ()=>expect(setSupportTakeover).toHaveBeenCalledWith(account.id,'chat-1',false,expect.anything()));
  });
});
