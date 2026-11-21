// @vitest-environment jsdom
import React from 'react';
import { fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,test,vi } from 'vitest';
import type { ChatSession } from '../api';
import { useChat } from '../hooks';
import Chat from './Chat';

vi.mock('../hooks', /* chatHookMockFactory 用确定性 React 状态替换远端聊天连接，检验页面真实点击与滚动。 */ () => ({ useChat: vi.fn() }));
vi.mock('../components/BrowserNotificationToggle', /* notificationStub 避免未读导航测试启动浏览器通知。 */ () => ({ default: /* emptyNotifications 不渲染与未读导航无关的浏览器通知入口。 */ () => null }));
vi.mock('../components/ChatMetadataFeature', /* metadataStub 避免未读导航测试依赖无关聊天详情接口。 */ () => ({ default: /* emptyChatMetadata 保证测试只覆盖列表导航，不加载元数据面板。 */ () => null }));

// alreadyRead 是默认展示但没有未读消息的会话。
const alreadyRead: ChatSession = { account_id: 'a1', chat_id: 'read-chat', peer_user_id: 'buyer-1', peer_name: '已读买家', last_message: '已回复', last_message_at: 2, unread_count: 0 };
// unreadChat 是点击顶部红色数字后需要显示的目标会话。
const unreadChat: ChatSession = { account_id: 'a1', chat_id: 'unread-chat', peer_user_id: 'buyer-2', peer_name: '未读买家', last_message: '有新问题', last_message_at: 1, unread_count: 1 };

afterEach(/* cleanUpUnreadJumpMock 恢复测试注入的浏览器滚动能力和状态替身。 */ () => vi.restoreAllMocks());

test('点击账号旁红色未读数字会打开未读会话并滚动到该行，账号标签仍是独立按钮',
  /* unreadNavigationTest 验证数字可点击、两个按钮无嵌套、自动定位和保留账号切换入口。 */ () => {
    // scrollSpy 记录真实列表行触发的滚动动作，jsdom 不实现浏览器原生 scrollIntoView。
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollSpy });
    // jumpSpy 记录用户点击的账号，目标聊天 ID 由模拟的聊天 Hook 返回。
    const jumpSpy = vi.fn(/* accountID 是被点击红色未读数字所属账号。 */ (_accountID: string) => 'unread-chat');
    // accountSelectSpy 确认红色徽标不是嵌套在切换账号的按钮中。
    const accountSelectSpy = vi.fn();
    vi.mocked(useChat).mockImplementation(/* unreadChatHookFixture 用真实 React 状态模拟点击后会话变化。 */ () => {
      // activeChatID、setActiveChatID 描述点击后右侧显示的具体会话。
      const [activeChatID, setActiveChatID] = React.useState('read-chat');
      // scrollRef 指向右侧聊天消息容器，供当前页面挂载。
      const scrollRef = React.useRef<HTMLDivElement | null>(null);
      // imageInputRef 对应聊天输入区的图片选择控件。
      const imageInputRef = React.useRef<HTMLInputElement | null>(null);
      return {
        accounts: [{ id: 'a1', nickname: '测试店铺', enabled: true, runtime_state: 'online' }],
        activeAccountID: 'a1', activeChatID, activeAccount: { id: 'a1', nickname: '测试店铺', enabled: true, runtime_state: 'online' },
        activeSessions: [alreadyRead, unreadChat], filteredSessions: [alreadyRead, unreadChat],
        selectedSession: activeChatID === 'unread-chat' ? unreadChat : alreadyRead,
        messages: [], search: '', unreadOnly: false, draft: '', loading: false, messagesLoading: false,
        olderLoading: false, hasOlder: false, contactsLoading: false, hasMoreContacts: false,
        emojiOpen: false, sending: false, error: '', sendNotice: '', liveState: 'online', pendingImage: null,
        scrollRef, imageInputRef, setActiveAccountID: accountSelectSpy, setActiveChatID, setSearch: vi.fn(),
        setUnreadOnly: vi.fn(), setDraft: vi.fn(), setEmojiOpen: vi.fn(),
        reloadSessions: vi.fn(), loadMoreContacts: vi.fn(), loadOlderMessages: vi.fn(), handleMessageScroll: vi.fn(),
        handleSend: vi.fn(), handleQuickReply: vi.fn(), handleQuickReplyImage: vi.fn(),
        handleLibraryImage: vi.fn(), handleImage: vi.fn(), handlePastedImages: vi.fn(),
        confirmSendImage: vi.fn(), closeImagePreview: vi.fn(), retrySend: vi.fn(), retryAvailable: false,
        deletingChatID: '', deleteError: '', deleteConversation: vi.fn(), clearDeleteError: vi.fn(),
        acceptOutgoingMessage: vi.fn(), unreadForAccount: vi.fn(/* accountID 是当前需显示未读徽标的账号。 */ () => 1),
        jumpToUnreadConversation: /* accountID 是点击来源，先记录再模拟 Hook 已选择目标会话。 */ (accountID: string) => {
          // targetChatID 保存当前未读查找结果，测试它的路由目标与列表行一致。
          const targetChatID = jumpSpy(accountID);
          setActiveChatID(targetChatID);
          return targetChatID;
        },
        emojiURL: vi.fn(), xianyuEmojis: [], renderXianyuText: vi.fn(), formatClock: vi.fn(/* timestamp 是消息时间。 */ () => ''),
        messageTime: vi.fn(/* timestamp 是平台消息时间。 */ () => ''),
      } as unknown as ReturnType<typeof useChat>;
    });
    // rendered 页面渲染结果用于释放当前测试 DOM。
    const rendered = render(<Chat />);
    // unreadButton 是单独可操作的账号未读数而非账号标签的一部分。
    const unreadButton = screen.getByRole('button', { name: '查看测试店铺的1条未读消息' });
    expect(unreadButton.closest('[role="tab"]')).toBeNull();
    fireEvent.click(unreadButton);
    expect(jumpSpy).toHaveBeenCalledWith('a1');
    expect(accountSelectSpy).not.toHaveBeenCalled();
    expect(screen.getByText('未读买家', { selector: 'div.truncate' })).toBeTruthy();
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    rendered.unmount();
  });
