// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readLastPublishLocation, saveLastPublishLocation, type RememberedPublishLocation } from './publishLocationPreference';

// location 是无需兴趣点的完整区县发货地样本。
const location: RememberedPublishLocation = { province: '浙江省', city: '杭州市', area: '西湖区', division_id: '330106', longitude: 120.1, latitude: 30.2, poi_id: '', poi_name: '' };

describe('发布地点的浏览器记忆', /* 隔离测试缓存恢复及异常存储行为。 */ () => {
  beforeEach(/* 清理上一用例保存的发货地，保证独立性。 */ () => window.localStorage.clear());

  test('首次无缓存；选到区县即可保存，刷新后恢复；清除后不再自动使用', /* 测试完整选择周期。 */ () => {
    expect(readLastPublishLocation()).toBeNull();
    saveLastPublishLocation(location);
    expect(readLastPublishLocation()).toEqual(location);
    saveLastPublishLocation(null);
    expect(readLastPublishLocation()).toBeNull();
  });

  test('损坏的缓存与零坐标不可自动用于平台发布', /* 验证旧缓存不绕过地址验证。 */ () => {
    window.localStorage.setItem('ydisks.publish.last_location.v1', '{broken');
    expect(readLastPublishLocation()).toBeNull();
    saveLastPublishLocation({ ...location, latitude: 0, longitude: 0 });
    expect(readLastPublishLocation()).toBeNull();
  });

  test('浏览器存储不可用时不阻断发布操作', /* 使用异常存储模拟受限制浏览器。 */ () => {
    // getItem、setItem 是抛错的浏览器存储方法，仅在当前测试中临时替换。
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(/* 模拟无权限读取。 */ () => { throw new Error('disabled'); });
    // setItem 保存浏览器禁止写入时的测试方法替身，用于恢复原实现。
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(/* 模拟无权限写入。 */ () => { throw new Error('disabled'); });
    expect(readLastPublishLocation()).toBeNull();
    expect(/* 受限存储不应打断用户选择。 */ () => saveLastPublishLocation(location)).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
