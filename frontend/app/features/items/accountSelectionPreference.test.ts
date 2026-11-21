// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readItemAccountPreference, saveItemAccountPreference, validItemAccountPreference } from './accountSelectionPreference';

describe('商品管理唯一账号选择记忆', /* accountSelectionPreferenceSuite 验证记忆与过期账号回退。 */ () => {
  beforeEach(/* clearAccountPreference 每条用例清理上一次的浏览器存储状态。 */ () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  test('初次进入为全部账号，选择后可恢复', /* restoreAccountCase 验证存储读写。 */ () => {
    expect(readItemAccountPreference()).toBe('');
    saveItemAccountPreference('account-2');
    expect(readItemAccountPreference()).toBe('account-2');
  });

  test('账号不存在时回退到全部账号', /* missingAccountCase 验证过期账号不能用于发布。 */ () => {
    expect(validItemAccountPreference('deleted', ['account-1'])).toBe('');
    expect(validItemAccountPreference('account-1', ['account-1'])).toBe('account-1');
    expect(validItemAccountPreference('', ['account-1'])).toBe('');
  });

  test('隐私模式拒绝本地存储时不影响界面操作', /* storageBlockedCase 验证存储异常安全回退。 */ () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(/* blockedRead 模拟浏览器拒绝读取。 */ () => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(/* blockedWrite 模拟浏览器拒绝写入。 */ () => { throw new Error('blocked'); });
    expect(readItemAccountPreference()).toBe('');
    expect(/* invokeBlockedSave 验证禁用浏览器存储时保存操作无异常。 */ () => saveItemAccountPreference('account-1')).not.toThrow();
  });
});
