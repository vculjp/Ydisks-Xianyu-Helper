import { Loader2,QrCode } from 'lucide-react';
import React,{ Suspense,useState } from 'react';
import { createPortal } from 'react-dom';
import { AccountDetail } from '../api';
import {
deleteAccount,
refreshAccountProfile,
updateAccountStatus,
} from '../api';
import { AccountAISettingsModal } from '../components/AccountAISettingsModal';
import AccountAutomationModal from '../components/AccountAutomationModal';
import AccountTable from '../components/AccountTable';
import { AccountSafetyPanel } from '../components/AccountSafetyPanel';
import { AccountDeleteDialog } from '../components/AccountDeleteDialog';
import { AccountQRCodeModal } from '../components/AccountQRCodeModal';
import { useAccountsData } from '../hooks';
import { useAccountQRCodeLogin } from '../qrLogin';
import { useAccountSubmodules,type AccountModalType } from '../submoduleHooks';
import type { AccountEditForm,AccountListProps } from '../types';
import { PageHeader } from '../../../../shared/ui/PageHeader';
import { AsyncStateView,notify } from '../../../../shared/ui/feedback';
import { useAsyncAction } from '../../../../shared/ui/useAsyncAction';

// EditModalLoading 是编辑弹窗分片下载期间的遮罩占位，避免点击“编辑”后界面无反馈。
const EditModalLoading: React.FC = () => (
  <div className="modal-overlay-centered" role="status" aria-label="正在加载编辑弹窗">
    <Loader2 className="w-8 h-8 animate-spin text-white" />
  </div>
);

// AccountList 渲染账号列表组件。
const AccountList: React.FC<AccountListProps> = ({ accountEditModal: AccountEditModal }) => {
  // accountData 保存账号列表及其加载控制器。
  const { accounts, setAccounts, loading, loadError, loadAccounts } = useAccountsData();
  // accountSearch 保存列表过滤关键词。
  const [accountSearch, setAccountSearch] = useState('');
  // deletingAccountId 保存正在删除的账号 ID。
  const [deletingAccountId, setDeletingAccountId] = useState<string>('');
  // accountActions 提供按账号动作隔离的防重复提交和统一提示。
  const accountActions = useAsyncAction();
  // deleteDialogAccount 保存待确认删除的账号。
  const [deleteDialogAccount, setDeleteDialogAccount] = useState<AccountDetail | null>(null);
  // deleteError 保存删除失败提示。
  const [deleteError, setDeleteError] = useState('');
  // activeModal 保存当前打开的账号配置弹窗。
  const [activeModal, setActiveModal] = useState<AccountModalType>(null);
  // editingAccount 保存当前编辑账号。
  const [editingAccount, setEditingAccount] = useState<AccountDetail | null>(null);
  // taskAccount 保存当前打开自动化任务弹窗的账号。
  const [taskAccount, setTaskAccount] = useState<AccountDetail | null>(null);

  // 编辑表单状态。
  // editForm 保存编辑弹窗中的账号草稿。
  const [editForm, setEditForm] = useState<AccountEditForm>({
    remark: '',
    cookie: '',
    auto_confirm: false,
    auto_consign: false,
    auto_bargain: false,
    consign_proof_mode: 'delivery',
    consign_proof_text: '',
    manual_takeover_minutes: 0,
    manual_takeover_scope: 'ai',
    pause_duration: 0,
    username: '',
    login_password: '',
    show_browser: false,
    showLoginPassword: false,
    clear_password: false,
  });

  // accountSubmodules 集中管理编辑弹窗的长登录、通知绑定、AI 和密码登录状态。
  const accountSubmodules = useAccountSubmodules({
    editingAccount,
    setEditingAccount,
    setActiveModal,
    editForm,
    setEditForm,
    loadAccounts,
  });
  // submoduleHandlers 保存编辑弹窗子模块的状态和事件处理函数。
  const {
    longLogin,
    notifChannels,
    selectedChannelIds,
    bindingsLoaded,
    bindingsLoading,
    bindingsLoadError,
    aiSettings,
    saving,
    passwordLoginView,
    setAiSettings,
    setBindingsDirty,
    openEditModal,
    closeEditModal,
    openAIModal,
    closeAIModal,
    loadNotificationBindings,
    toggleNotificationChannel,
    handleLongLoginToggle,
    handleSaveAISettings,
    handleSaveEdit,
    handleRestartPause,
    handlePasswordLogin,
    handleCancelPasswordLogin,
  } = accountSubmodules;

  // qrLogin 集中管理二维码弹窗状态、轮询、风控验证和异步资源收束。
  const qrLogin = useAccountQRCodeLogin({ onLoginSuccess: loadAccounts });
  // qrViewState 解构二维码弹窗向页面展示和触发操作所需的最小状态。
  const {
    showQRModal,
    qrCodeUrl,
    qrStatus,
    qrErrorMessage,
    verificationScreenshot,
    faceQrUrl,
    qrReauthTarget,
    startQRLogin,
    closeQRModal,
  } = qrLogin;

  // handleToggle 切换账号启用状态，并在成功后刷新服务端运行状态。
  const handleToggle = async (id: string, currentStatus: boolean) => {
    await accountActions.run(
      `toggle:${id}`,
      /* 账号启停请求成功后刷新服务端运行状态，避免只更新本地开关。 */ async () => {
        await updateAccountStatus(id, !currentStatus);
        await loadAccounts();
      },
      { successMessage: currentStatus ? '账号已停用' : '账号已启用' },
    );
  };

  // openDeleteDialog 打开账号删除确认框。
  const openDeleteDialog = (account: AccountDetail) => {
    if (deletingAccountId) return;
    setDeleteError('');
    setDeleteDialogAccount(account);
  };

  // closeDeleteDialog 关闭账号删除确认框。
  const closeDeleteDialog = () => {
    if (deletingAccountId) return;
    setDeleteError('');
    setDeleteDialogAccount(null);
  };

  // confirmDeleteAccount 执行账号删除并刷新列表状态。
  const confirmDeleteAccount = async () => {
    // account 保存当前确认删除的账号。
    const account = deleteDialogAccount;
    if (!account || deletingAccountId) return;
    setDeletingAccountId(account.id);
    setDeleteError('');
    try {
      await deleteAccount(account.id);
      setAccounts(/* 当前回调处理集合中的单个元素。 */ current => current.filter(/* 当前回调处理集合中的单个元素。 */ item => item.id !== account.id));
      setDeleteDialogAccount(null);
      notify('success', `账号 ${account.nickname || account.remark || account.id} 已删除`);
    } catch (/* error 保存账号删除请求的失败原因，仅转换为界面提示。 */ error: any) {
      console.error('删除账号失败:', error);
      // message 是删除失败后允许在确认框中展示的脱敏说明。
      const message = error?.message || '删除账号失败，请稍后重试';
      setDeleteError(message);
      notify('error', message);
    } finally {
      setDeletingAccountId('');
    }
  };

  // handleRefreshProfile 刷新账号资料并同步列表。
  const handleRefreshProfile = async (account: AccountDetail) => {
    await accountActions.run(
      `refresh:${account.id}`,
      /* 账号资料刷新成功后再读取列表，确保昵称、头像和告警使用服务端最新值。 */ async () => {
        // res 保存资料刷新接口返回值，profile_error 表示平台未返回完整公开资料。
        const res = await refreshAccountProfile(account.id);
        await loadAccounts();
        return res;
      },
      {
        onSuccess: /* 资料刷新成功回调区分平台警告与完整成功。 */ res => {
          if (res?.profile_error) notify('warning', `资料刷新未完整成功：${res.profile_error}`);
          else notify('success', '账号资料已刷新');
        },
        errorMessage: '刷新账号资料失败，请重新授权后再试',
      },
    );
  };
  if ((loading || loadError) && accounts.length === 0) {
    return (
      <AsyncStateView
        loading={loading}
        error={loadError}
        empty={false}
        onRetry={/* 错误态重试重新读取账号列表。 */ () => void loadAccounts()}
        loadingText="正在加载账号"
      />
    );
  }

  // filteredAccounts 过滤后的账号列表，负责当前功能中的对应处理。
  const filteredAccounts = accounts.filter(/* 当前回调处理集合中的单个元素。 */ account => {
    // keyword 搜索关键词。
    const keyword = accountSearch.trim().toLowerCase();
    if (!keyword) return true;
    return [
      account.id,
      account.nickname,
      account.remark,
      account.username,
      account.runtime_message,
    ].some(/* 当前回调处理用户交互或异步状态变化。 */ value => (value || '').toLowerCase().includes(keyword));
  });

  return (
    <div className="min-w-0 space-y-6 animate-fade-in">
      <PageHeader title="账号管理" description="管理您的闲鱼授权账号及设置。建议给账号填写备注，便于多账号区分。">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={accountSearch}
            onChange={/* 当前回调处理用户交互或异步状态变化。 */ event => setAccountSearch(event.target.value)}
            placeholder="搜索昵称 / 备注 / 账号ID"
            className="ios-input w-full rounded px-3 py-2 text-sm sm:w-72"
          />
          <button
            onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => startQRLogin()}
            className="ios-btn-primary flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-medium"
          >
            <QrCode className="w-4 h-4" />
            扫码添加新账号
          </button>
        </div>
      </PageHeader>

      <AccountSafetyPanel accounts={accounts} refresh={loadAccounts} />

      <div className="flex flex-col gap-2 rounded border border-brand-100 bg-brand-50 px-4 py-3 text-xs text-slate-700 md:flex-row md:items-center md:justify-between">
        <div className="font-medium">当前显示 {filteredAccounts.length} / {accounts.length} 个账号</div>
        <div>如果账号只显示 ID，点该行“刷新资料”；刷新失败时请重新授权。</div>
      </div>

      <AsyncStateView
        loading={false}
        empty={filteredAccounts.length === 0}
        emptyTitle={accounts.length === 0 ? '暂无账号' : '没有匹配的账号'}
        emptyDescription={accounts.length === 0 ? '请点击右上角扫码添加您的闲鱼账号。' : '换一个关键词搜索昵称、备注或账号 ID。'}
      >
        <AccountTable
          accounts={filteredAccounts}
          isPending={/* 账号动作忙碌判断直接复用页面级请求锁。 */ accountActions.isPending}
          onRefreshProfile={handleRefreshProfile}
          onReauthorize={startQRLogin}
          onEdit={openEditModal}
          onAI={openAIModal}
          onTasks={setTaskAccount}
          onToggle={handleToggle}
          onDelete={openDeleteDialog}
        />
      </AsyncStateView>

      {taskAccount && createPortal(
        <AccountAutomationModal
          account={taskAccount}
          onClose={/* 当前回调处理用户交互或异步状态变化。 */ () => setTaskAccount(null)}
          onSaved={/* 当前回调处理集合中的单个元素。 */ settings => {
            setAccounts(/* 当前回调处理集合中的单个元素。 */ current => current.map(/* 当前回调处理集合中的单个元素。 */ account => account.id === taskAccount.id ? {
              ...account,
              auto_rate_enabled: settings.auto_rate_enabled,
              rate_content: settings.rate_content,
              auto_polish_enabled: settings.auto_polish_enabled,
              polish_time: settings.polish_time,
              last_rate_scan_at: settings.last_rate_scan_at,
              last_polish_date: settings.last_polish_date,
              last_polish_at: settings.last_polish_at,
            } : account));
          }}
        />,
        document.body
      )}

      {deleteDialogAccount && (
        <AccountDeleteDialog
          account={deleteDialogAccount}
          deleting={Boolean(deletingAccountId)}
          error={deleteError}
          onClose={closeDeleteDialog}
          onConfirm={confirmDeleteAccount}
        />
      )}

      {showQRModal && (
        <AccountQRCodeModal
          target={qrReauthTarget}
          status={qrStatus}
          codeUrl={qrCodeUrl}
          errorMessage={qrErrorMessage}
          faceQrUrl={faceQrUrl}
          verificationScreenshot={verificationScreenshot}
          onClose={closeQRModal}
        />
      )}

      {/* 编辑账号弹窗由 accounts feature 组件负责渲染和表单交互。 */}
      {activeModal === 'edit' && editingAccount && (
        <Suspense fallback={<EditModalLoading />}>
        <AccountEditModal
          account={editingAccount}
          editForm={editForm}
          setEditForm={setEditForm}
          saving={saving}
          onClose={closeEditModal}
          onSave={handleSaveEdit}
          onRestartPause={handleRestartPause}
          longLogin={longLogin}
          onToggleLongLogin={handleLongLoginToggle}
          passwordLoginView={passwordLoginView}
          onPasswordLogin={handlePasswordLogin}
          onCancelPasswordLogin={handleCancelPasswordLogin}
          notifChannels={notifChannels}
          selectedChannelIds={selectedChannelIds}
          bindingsLoaded={bindingsLoaded}
          bindingsLoading={bindingsLoading}
          bindingsLoadError={bindingsLoadError}
          onRetryBindings={/* 当前回调处理用户交互或异步状态变化。 */ () => loadNotificationBindings(editingAccount.id)}
          onToggleChannel={toggleNotificationChannel}
          onSettingsDirty={/* 当前回调处理用户交互或异步状态变化。 */ () => setBindingsDirty(true)}
        />
        </Suspense>
      )}


      {activeModal === 'ai-settings' && editingAccount && (
        <AccountAISettingsModal
          account={editingAccount}
          settings={aiSettings}
          saving={saving}
          onChange={setAiSettings}
          onClose={closeAIModal}
          onSave={handleSaveAISettings}
        />
      )}
    </div>
  );
};

export default AccountList;
