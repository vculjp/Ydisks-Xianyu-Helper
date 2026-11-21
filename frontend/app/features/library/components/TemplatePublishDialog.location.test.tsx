// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readLastPublishLocation, saveLastPublishLocation } from '../../../../shared/browser/publishLocationPreference';
import { TemplatePublishDialog } from './TemplatePublishDialog';
import type { LibraryLocationFieldComponent } from '../types';

// districtLocation 是仅含真实行政区和区县中心、不含详细地点的发货地测试样本。
const districtLocation = { province: '浙江省', city: '杭州市', area: '西湖区', division_id: '330106', longitude: 120.12, latitude: 30.25, poi_id: '', poi_name: '' };

// TestLocationField 只展示对话框传入的受控发货地，用于观察恢复和清除而不访问高德。
const TestLocationField: LibraryLocationFieldComponent = ({ value, onChange }) => <div>
  <span data-testid="selected-district">{value?.area || '未选择'}</span>
  <button type="button" onClick={/* 清除显式选择和本地记忆。 */ () => onChange(null)}>清除模板发货地</button>
</div>;

describe('模板发布复用上次发货地', /* 检查资源库弹窗与商品管理共享的浏览器选择。 */ () => {
  beforeEach(/* 清理上个用例的浏览器偏好。 */ () => window.localStorage.clear());
  afterEach(/* 卸载资源库弹窗并清除本地地址偏好，避免影响其他用例。 */ () => { cleanup(); window.localStorage.clear(); });

  test('打开资源库发布时自动带出上次区县，清除后不再保留', /* 测试模板入口的无需重新勾选体验。 */ () => {
    saveLastPublishLocation(districtLocation);
    render(<TemplatePublishDialog templates={[]} accounts={[]} locationField={TestLocationField} onClose={vi.fn()} onStarted={vi.fn()} />);
    expect(screen.getByTestId('selected-district').textContent).toBe('西湖区');
    fireEvent.click(screen.getByText('清除模板发货地'));
    expect(screen.getByTestId('selected-district').textContent).toBe('未选择');
    expect(readLastPublishLocation()).toBeNull();
  });
});
