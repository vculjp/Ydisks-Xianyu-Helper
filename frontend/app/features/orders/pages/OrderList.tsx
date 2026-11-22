import { ChevronLeft,ChevronRight,Edit,ExternalLink,Eye,PackageCheck,RefreshCw,Save,Trash2,Truck,User as UserIcon,X } from 'lucide-react';
import React from 'react';
import { createPortal } from 'react-dom';
import { formatLocalDateTime } from '../../../../dateTime';
import type { OrderStatus } from '../api';
import { DeliveredCardsSection } from '../components/DeliveredCardsSection';
import { SHOW_CARD_UI } from '../../../../shared/ui/featureVisibility';
import { OrderFilterBar } from '../components/OrderFilterBar';
import { useOrderQuery } from '../hooks';
import { useOrderActions } from '../orderActions';
import { PageHeader } from '../../../../shared/ui/PageHeader';
import { AsyncStateView } from '../../../../shared/ui/feedback';

// StatusBadge 渲染订单状态徽标。
const StatusBadge: React.FC<{ /** status 表示状态。 */ status: OrderStatus }> = ({ status }) => {
  // styles 样式表。
  const styles = {
    processing: 'bg-blue-100 text-blue-800',
    pending_ship: 'bg-brand text-white',
    shipped: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-500',
    refunding: 'bg-red-100 text-red-600',
    unknown: 'bg-gray-100 text-gray-500',
  };

  // labels labels，负责当前功能中的对应处理。
  const labels = {
    processing: '处理中',
    pending_ship: '待发货',
    shipped: '已发货',
    completed: '已完成',
    cancelled: '已取消',
    refunding: '退款中',
    unknown: '待核实',
  };

  return (
    <span title={status === 'unknown' ? '尚未从闲鱼平台核实订单状态，不代表未付款或未发货' : undefined} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${styles[status] || styles.cancelled}`}>
      {labels[status] || status}
    </span>
  );
};

// OrderList 渲染订单列表组件。
const OrderList: React.FC = () => {
  // orderQuery 负责订单查询、筛选、分页和展示辅助数据。
  const orderQuery = useOrderQuery();
  // { 解构得到当前 Hook 返回的状态和操作函数。
  const { orders, accounts, filter, setFilter, accountFilter, setAccountFilter, searchText, setSearchText, page, setPage, totalPages, loading, loadError = '', loadOrders, accountName, accountNickname, getItemNameById } = orderQuery;
  // orderActions 集中管理订单动作、弹窗状态和异步结果。
  const orderActions = useOrderActions({ orders, page, accountFilter, filter, searchText, setPage, loadOrders });
  // actionState 解构得到页面动作协调器的状态和操作函数。
  const {
    showDetailModal,
    selectedOrder,
    showEditModal,
    editingOrder,
    showShipModal,
    shipLoading,
    shipResult,
    syncingOrderId,
    deletingOrderId,
    savingEdit,
    handleSync,
    handleShip,
    executeShip,
    handleViewDetail,
    handleEdit,
    handleSaveEdit,
    updateEditingOrder,
    handleSyncSingle,
    handleDelete,
    closeDetailModal,
    closeEditModal,
    closeShipModal,
  } = orderActions;
  // incompleteOrderCount 仅统计本页缺少平台确认字段的订单，提示不能当作已付款或已发货。
  const incompleteOrderCount = orders.filter(/* order 保留信息未核实的订单。 */ order => order.status === 'unknown' || !order.amount || order.quantity <= 0).length;

  // handleFilterChange 切换订单状态筛选并回到第一页。
  const handleFilterChange = (value: string) => {
    setFilter(value);
    setPage(1);
    setSearchText('');
  };
  // handleAccountFilterChange 切换账号筛选并回到第一页。
  const handleAccountFilterChange = (value: string) => {
    setAccountFilter(value);
    setPage(1);
  };
  // handleSearchChange 更新订单搜索文本并回到第一页。
  const handleSearchChange = (value: string) => {
    setSearchText(value);
    setPage(1);
  };

  return (
    <div className="min-w-0 space-y-6 animate-fade-in">
      <PageHeader title="订单中心" description="查看所有闲鱼交易记录与状态。">
        <div className="flex items-center gap-3">
            <button onClick={/* 手动刷新订单列表。 */ () => void loadOrders()} disabled={loading} aria-label="刷新订单列表" className="rounded border border-line bg-white p-2 text-gray-600 transition-colors hover:border-brand hover:text-brand disabled:cursor-wait disabled:opacity-50">
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={/* 同步当前筛选条件下的订单。 */ handleSync} disabled={loading} className="ios-btn-primary flex items-center gap-2 rounded px-4 py-2 text-sm font-medium disabled:opacity-50">
                <Truck className="w-5 h-5" />
                一键同步订单
            </button>
        </div>
      </PageHeader>

      {loadError && orders.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded border border-danger-200 bg-danger-50 px-4 py-3 text-xs text-danger-700">
          <span>{loadError}。当前展示的是上一次成功读取的订单。</span>
          <button type="button" className="console-link-button" onClick={/* 保留当前数据并重新加载订单。 */ () => void loadOrders()}>重新加载</button>
        </div>
      )}

      <div className="console-table-shell">
        <OrderFilterBar
          filter={filter}
          onFilterChange={handleFilterChange}
          accountFilter={accountFilter}
          onAccountFilterChange={handleAccountFilterChange}
          accounts={accounts}
          accountName={accountName}
          searchText={searchText}
          onSearchChange={handleSearchChange}
        />

        {incompleteOrderCount > 0 && (
          <div role="status" className="mx-5 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            本页有 {incompleteOrderCount} 笔订单的信息尚未核实。实时消息可能只提供订单号；如卖家订单列表同步提示“无权限访问”，金额、数量与状态将无法补全。
            请在闲鱼官方订单详情中确认实际付款、发货情况，勿根据这里的待核实状态重复发货。
          </div>
        )}

        {/* Table */}
        {orders.length === 0 ? (
          <AsyncStateView
            loading={loading && orders.length === 0}
            error={loadError && orders.length === 0 ? loadError : ''}
            empty={!loading && !loadError && orders.length === 0}
            onRetry={/* 订单读取失败时重新请求当前筛选页。 */ () => void loadOrders()}
            emptyTitle="暂无订单"
            emptyDescription="当前筛选条件下没有订单；可切换筛选或先在闲鱼同步订单。"
            loadingText="正在加载订单"
          />
        ) : (
        <div className="console-table-wrap min-h-[400px]">
          <table className="console-table" style={{ minWidth: 1240 }}>
            <thead>
              <tr>
                <th className="px-6" style={{width: '28%'}}>订单信息</th>
                <th className="px-6" style={{width: '26%'}}>买家信息</th>
                <th className="px-6" style={{width: '11%'}}>实付金额</th>
                <th className="px-6" style={{width: '13%'}}>当前状态</th>
                <th className="px-6 text-right" style={{width: '22%'}}>操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(/* 当前回调处理集合中的单个元素。 */ (order) => (
                <tr key={order.id} className="hover:bg-warning-50/50 transition-colors group">
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-5">
                      <div className="w-14 h-14 rounded-xl bg-gray-100 overflow-hidden shadow-sm border border-gray-100 flex-shrink-0">
                        {order.item_image ? (
                            <img src={order.item_image} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300"><PackageCheck /></div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-gray-900 line-clamp-1 text-sm">
                          {getItemNameById(order.cookie_id, order.item_id, order.item_title)}
                        </div>
                        <div className="mt-1 flex w-fit min-w-0 max-w-full items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-extrabold text-blue-700" title={accountNickname(order.cookie_id)}>
                          <UserIcon className="h-3 w-3 shrink-0" />
                          <span className="min-w-0 truncate whitespace-nowrap">{accountNickname(order.cookie_id)}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1 font-medium">订单ID: {order.order_id}</div>
                        <div className="text-xs text-gray-400 mt-0.5">数量: {order.quantity > 0 ? order.quantity : '待获取'} • {formatLocalDateTime(order.created_at)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                      <div className="flex flex-col gap-1">
                          <div className="text-xs text-gray-500">买家ID</div>
                          <div className="text-sm font-bold text-gray-800">{order.buyer_id}</div>
                          {order.receiver_name && (
                              <>
                                  <div className="text-xs text-gray-500">收货人</div>
                                  <div className="text-xs text-gray-600">{order.receiver_name}</div>
                              </>
                          )}
                          {order.receiver_phone && (
                              <>
                                  <div className="text-xs text-gray-500">联系电话</div>
                                  <div className="text-xs text-gray-600 font-mono">{order.receiver_phone}</div>
                              </>
                          )}
                          {order.receiver_address && (
                              <>
                                  <div className="text-xs text-gray-500">收货地址</div>
                                  <div className="text-xs text-gray-600 line-clamp-1">{order.receiver_address}</div>
                              </>
                          )}
                      </div>
                  </td>
                  <td className="px-6 py-5 text-base font-extrabold text-gray-900 font-feature-settings-tnum">
                    {order.amount ? `¥${order.amount}` : <span className="text-xs text-amber-600 font-bold">待获取</span>}
                  </td>
                  <td className="px-6 py-5">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-6 text-right">
                    {order.status === 'pending_ship' && (
                        <button
                            onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => handleShip(order.order_id)}
                            className="mr-2 text-white bg-black hover:bg-gray-800 shadow-lg shadow-gray-200 text-xs font-bold px-3 py-2 rounded-xl transition-all active:scale-95"
                        >
                            立即发货
                        </button>
                    )}
                    <a
                      href={`https://www.goofish.com/order-detail?orderId=${order.order_id}&role=seller`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mr-2 inline-flex text-gray-400 hover:text-blue-600 p-2 rounded-xl hover:bg-blue-50 transition-colors"
                      title="查看闲鱼详情"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button
                      onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => handleViewDetail(order)}
                      className="mr-2 text-gray-400 hover:text-blue-600 p-2 rounded-xl hover:bg-blue-50 transition-colors"
                      title="查看详情"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => handleEdit(order)}
                      className="mr-2 text-gray-400 hover:text-black p-2 rounded-xl hover:bg-gray-100 transition-colors"
                      title="编辑订单"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => handleSyncSingle(order.order_id)}
                      disabled={syncingOrderId === order.order_id}
                      className="mr-2 text-gray-400 hover:text-green-600 p-2 rounded-xl hover:bg-green-50 transition-colors disabled:opacity-50"
                      title="同步订单"
                    >
                      <RefreshCw className={`w-4 h-4 ${syncingOrderId === order.order_id ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => handleDelete(order.order_id)}
                      disabled={deletingOrderId === order.order_id}
                      className="text-gray-400 hover:text-red-500 p-2 rounded-xl hover:bg-red-50 transition-colors disabled:opacity-50"
                      title="删除订单"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {/* Pagination */}
        <div className="p-4 border-t border-gray-50 flex items-center justify-between bg-white">
            <div className="text-sm text-gray-500 font-medium pl-2">
                第 {page} 页 / 共 {totalPages} 页
            </div>
            <div className="flex gap-2">
                <button
                    disabled={page <= 1}
                    onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setPage(/* 当前回调处理用户交互或异步状态变化。 */ p => p - 1)}
                    aria-label="上一页"
                    className="p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-gray-600 transition-colors"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                    disabled={page >= totalPages}
                    onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => setPage(/* 当前回调处理用户交互或异步状态变化。 */ p => p + 1)}
                    aria-label="下一页"
                    className="p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-gray-600 transition-colors"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </div>
      </div>

      {/* 订单详情弹窗 - 使用 Portal */}
      {showDetailModal && selectedOrder && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container">
            <div className="modal-header">
              <div className="flex items-center justify-between w-full">
                <h3 className="text-2xl font-extrabold text-gray-900">订单详情</h3>
                <button
                  onClick={closeDetailModal}
                  className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            <div className="modal-body space-y-6">
              {/* Order Info */}
              <div className="space-y-4">
                <h4 className="text-lg font-bold text-gray-800">订单信息</h4>
                <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">订单号</div>
                    <div className="font-mono text-sm font-bold text-gray-900">{selectedOrder.order_id}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">所属账号</div>
                    <div className="truncate whitespace-nowrap text-sm font-bold text-blue-700" title={accountNickname(selectedOrder.cookie_id)}>{accountNickname(selectedOrder.cookie_id)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">状态</div>
                    <StatusBadge status={selectedOrder.status} />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">实付金额</div>
                    <div className="text-lg font-extrabold text-gray-900">{selectedOrder.amount ? `¥${selectedOrder.amount}` : '待获取'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">数量</div>
                    <div className="font-bold text-gray-900">{selectedOrder.quantity > 0 ? selectedOrder.quantity : '待获取'}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-gray-500 mb-1">创建时间</div>
                    <div className="text-sm font-medium text-gray-700">{formatLocalDateTime(selectedOrder.created_at)}</div>
                  </div>
                </div>
              </div>

              {/* Item Info */}
              <div className="space-y-4">
                <h4 className="text-lg font-bold text-gray-800">商品信息</h4>
                <div className="p-4 bg-gray-50 rounded-xl flex items-center gap-4">
                  {selectedOrder.item_image && (
                    <img src={selectedOrder.item_image} alt="" className="w-20 h-20 rounded-xl object-cover border border-gray-200" />
                  )}
                  <div className="flex-1">
                    <div className="font-bold text-gray-900 mb-1">
                      {getItemNameById(selectedOrder.cookie_id, selectedOrder.item_id, selectedOrder.item_title)}
                    </div>
                    <div className="text-sm text-gray-500">商品ID: {selectedOrder.item_id}</div>
                    {selectedOrder.item_price && (
                      <div className="text-sm text-gray-500 mt-1">标价: ¥{selectedOrder.item_price}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Buyer Info */}
              <div className="space-y-4">
                <h4 className="text-lg font-bold text-gray-800">买家信息</h4>
                <div className="p-4 bg-gray-50 rounded-xl space-y-3">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">买家ID</div>
                    <div className="font-bold text-gray-900">{selectedOrder.buyer_id}</div>
                  </div>
                  {selectedOrder.receiver_name && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">收货人</div>
                      <div className="font-medium text-gray-700">{selectedOrder.receiver_name}</div>
                    </div>
                  )}
                  {selectedOrder.receiver_phone && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">联系电话</div>
                      <div className="font-mono text-sm text-gray-700">{selectedOrder.receiver_phone}</div>
                    </div>
                  )}
                  {selectedOrder.receiver_address && (
                    <div>
                      <div className="text-xs text-gray-500 mb-1">收货地址</div>
                      <div className="text-sm text-gray-700">{selectedOrder.receiver_address}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* 已发卡密：按订单号 key 挂载，切换订单会取消旧请求并清空明文 */}
              {SHOW_CARD_UI && <DeliveredCardsSection key={selectedOrder.order_id} orderId={selectedOrder.order_id} />}
            </div>

            <div className="modal-footer">
              <div className="flex gap-3 w-full">
                <button
                  onClick={closeDetailModal}
                  className="flex-1 px-6 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold transition-colors"
                >
                  关闭
                </button>
                {selectedOrder.status === 'pending_ship' && (
                  <button
                    onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => {
                      closeDetailModal();
                      handleShip(selectedOrder.order_id);
                    }}
                    className="flex-1 px-6 py-3 rounded-xl ios-btn-primary font-bold shadow-lg shadow-blue-200"
                  >
                    立即发货
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}


      {/* Ship Modal - 发货方式选择 */}
      {showShipModal && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <div className="flex items-center justify-between w-full">
                <h3 className="text-2xl font-extrabold text-gray-900">立即发货</h3>
                <button
                  onClick={closeShipModal}
                  className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            <div className="modal-body space-y-4">
              <p className="text-sm text-gray-600">请选择发货方式：</p>

              {/* 选项A: 仅修改发货状态 */}
              <button
                onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => executeShip('status_only')}
                disabled={shipLoading}
                className="w-full text-left p-4 rounded-xl border-2 border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Truck className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 text-sm">仅修改闲鱼发货状态</div>
                    <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                      不会再次发送发货内容，仅在闲鱼平台将订单标记为“已发货”。
                      适用于买家已经收到网盘链接或其他内容，但平台仍显示待发货的订单。
                    </div>
                  </div>
                </div>
              </button>

              {/* 选项B: 完整发货流程 */}
              <button
                onClick={/* 当前回调处理用户交互或异步状态变化。 */ () => executeShip('full_delivery')}
                disabled={shipLoading}
                className="w-full text-left p-4 rounded-xl border-2 border-gray-200 hover:border-brand hover:bg-blue-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <PackageCheck className="w-5 h-5 text-blue-700" />
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 text-sm">完整发货（按规则发送内容）</div>
                    <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                      按已配置的发货规则发送对应内容，并更新闲鱼订单状态。
                      仅适用于尚未发送发货内容且仍待发货的订单，已经发送过网盘链接的订单请使用上方选项。
                    </div>
                  </div>
                </div>
              </button>

              {/* 加载状态 */}
              {shipLoading && (
                <div className="flex items-center justify-center gap-2 py-3">
                  <RefreshCw className="w-4 h-4 animate-spin text-gray-500" />
                  <span className="text-sm text-gray-500">正在处理中...</span>
                </div>
              )}

              {/* 结果显示 */}
              {shipResult && (
                <div className={`p-3 rounded-xl text-sm ${shipResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                  {shipResult.success ? '✓ ' : '✗ '}{shipResult.message}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                onClick={closeShipModal}
                className="w-full px-6 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold transition-colors"
              >
                {shipResult?.success ? '完成' : '取消'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Modal - 使用 Portal */}
      {showEditModal && editingOrder && createPortal(
        <div className="modal-overlay-centered">
          <div className="modal-container">
            <div className="modal-header">
              <div className="flex items-center justify-between w-full">
                <h3 className="text-2xl font-extrabold text-gray-900">编辑订单</h3>
                <button
                  onClick={closeEditModal}
                  className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            <div className="modal-body space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">订单号</label>
                  <input
                    type="text"
                    value={editingOrder.order_id}
                    disabled
                    className="w-full ios-input px-4 py-3 rounded-xl bg-gray-50 text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">订单状态</label>
                  <select
                    value={editingOrder.status}
                    onChange={/* 当前回调更新订单状态草稿。 */ (e) => updateEditingOrder({ status: e.target.value as OrderStatus })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  >
                    <option value="processing">处理中</option>
                    <option value="pending_ship">待发货</option>
                    <option value="shipped">已发货</option>
                    <option value="completed">已完成</option>
                    <option value="cancelled">已取消</option>
                    <option value="refunding">退款中</option>
                    <option value="unknown" disabled>待核实（请先确认实际状态）</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">买家ID</label>
                  <input
                    type="text"
                    value={editingOrder.buyer_id}
                    onChange={/* 当前回调更新买家标识草稿。 */ (e) => updateEditingOrder({ buyer_id: e.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">实付金额</label>
                  <input
                    type="number"
                    value={editingOrder.amount}
                    onChange={/* 当前回调更新订单金额草稿。 */ (e) => updateEditingOrder({ amount: e.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">收货人</label>
                  <input
                    type="text"
                    value={editingOrder.receiver_name || ''}
                    onChange={/* 当前回调更新收货人草稿。 */ (e) => updateEditingOrder({ receiver_name: e.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">联系电话</label>
                  <input
                    type="text"
                    value={editingOrder.receiver_phone || ''}
                    onChange={/* 当前回调更新收货电话草稿。 */ (e) => updateEditingOrder({ receiver_phone: e.target.value })}
                    className="w-full ios-input px-4 py-3 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">收货地址</label>
                <textarea
                  value={editingOrder.receiver_address || ''}
                  onChange={/* 当前回调更新收货地址草稿。 */ (e) => updateEditingOrder({ receiver_address: e.target.value })}
                  rows={2}
                  className="w-full ios-input px-4 py-3 rounded-xl resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">商品标题</label>
                <input
                  type="text"
                  value={editingOrder.item_title || ''}
                  onChange={/* 当前回调更新商品标题草稿。 */ (e) => updateEditingOrder({ item_title: e.target.value })}
                  className="w-full ios-input px-4 py-3 rounded-xl"
                />
              </div>
            </div>

            <div className="modal-footer">
              <div className="flex gap-3 w-full">
                <button
                  onClick={closeEditModal}
                  className="flex-1 px-6 py-3 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  className="ios-btn-primary flex flex-1 items-center justify-center gap-2 rounded px-6 py-3 font-medium disabled:cursor-wait disabled:opacity-50"
                >
                  {savingEdit ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {savingEdit ? '正在保存' : '保存更改'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default OrderList;
