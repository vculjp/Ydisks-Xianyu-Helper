// ITEM_ACCOUNT_SELECTION_KEY 是商品管理页记住唯一账号选择的本地存储键。
const ITEM_ACCOUNT_SELECTION_KEY = 'ydisks.items.selected_account';

// readItemAccountPreference 读取上次使用的商品账号；空值表示“全部账号（仅查看）”。
export const readItemAccountPreference = (): string => {
  try {
    return window.localStorage.getItem(ITEM_ACCOUNT_SELECTION_KEY)?.trim() || '';
  } catch {
    // 隐私模式禁用本地存储时，安全回退到全部账号视图。
    return '';
  }
};

// saveItemAccountPreference 保存当前商品管理账号，失败时不影响本次页面操作。
export const saveItemAccountPreference = (accountID: string): void => {
  try {
    window.localStorage.setItem(ITEM_ACCOUNT_SELECTION_KEY, accountID);
  } catch {
    // 本地存储不可用时仅放弃跨页面记忆，不触发远端请求。
  }
};

// validItemAccountPreference 检查记忆账号是否仍在当前账号列表里，不存在时回退为全部账号。
export const validItemAccountPreference = (accountID: string, availableIDs: readonly string[]): string => (
  accountID && availableIDs.includes(accountID) ? accountID : ''
);
