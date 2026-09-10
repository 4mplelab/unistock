import type {
  StockSchedule,
  StockScheduleCreateInput,
  StockScheduleListResult,
  StockScheduleUpdateInput,
} from "../types/schedule";
import type { ItemInfo, ItemOption, ItemVariation } from "../types/item";
import type {
  ManualItem,
  ManualItemConsumeInput,
  ManualItemCreateInput,
  ManualItemUpdateInput,
  ManualOrderCreateInput,
  ManualOrderCsvColumnMapping,
  ManualOrderCsvPreview,
  ManualOrderImportProfile,
  ManualOrderImportProfileCreateInput,
  ManualOrderImportResult,
} from "../types/manualItem";
import type { AppSetting } from "../types/setting";
import type { Part, PartCreateInput, PartImportResult, PartUpdateInput } from "../types/part";
import type { ReservingOrder } from "../types/order_reservation";
import type {
  AssemblyBuildSummary,
  ConsumptionSummary,
  StockMovement,
  StockMovementFilters,
  StockMovementListResult,
} from "../types/stock_movement";
import type {
  Assembly,
  AssemblyBuildInput,
  AssemblyCreateInput,
  AssemblyImportResult,
  AssemblyItem,
  AssemblyItemInput,
  AssemblyUpdateInput,
  AssemblyUsages,
} from "../types/assembly";
import type {
  BomImportResult,
  BomItem,
  BomListResult,
  BomProductSetting,
  BomReplaceInput,
} from "../types/bom";
import type { IngestionResult, Order, OrderListResult, OrderRetryReservationResult } from "../types/order";
import type { OrderSummary } from "../types/order_summary";
import type {
  LeadTimeSummary,
  PurchaseOrder,
  PurchaseOrderCreateInput,
  PurchaseOrderListResult,
  ReorderNeeded,
} from "../types/purchase_order";
import type { EventLogListResult } from "../types/event_log";
import type { AllowedUser, AllowedUserCreateInput, ApiKey, ApiKeyCreateResult, CurrentUser, OAuthProvider } from "../types/auth";
import type { NavCounts } from "../types/nav_counts";
import type { Shop, ShopCreateInput, ShopUpdateInput } from "../types/shop";
import type { SalesSummary } from "../types/sales";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

// 未ログイン(401)を検知したら、業務APIのどこから呼ばれても一律ログイン画面に飛ばす。
// ログイン画面自体からの呼び出しでループしないようガードする。初回セットアップ
// ウィザード(/setup)は未ログインの間も自分で「ログインしてください」ステップを
// 表示するため、ここでも強制送還しない
function redirectToLogin() {
  if (window.location.pathname !== "/login" && window.location.pathname !== "/setup") {
    window.location.href = "/login";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...init,
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error("ログインが必要です");
  }
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.detail === "string") message = parsed.detail;
    } catch {
      // JSONでなければ生テキストのまま
    }
    throw new Error(message);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function fetchSchedules(
  limit: number,
  offset: number,
  shopId?: number,
  status?: string
): Promise<StockScheduleListResult> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (shopId != null) params.set("shop_id", String(shopId));
  if (status != null) params.set("status", status);
  return request<StockScheduleListResult>(`/schedules?${params.toString()}`);
}

export function createSchedule(input: StockScheduleCreateInput): Promise<StockSchedule> {
  return request<StockSchedule>("/schedules", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchSchedule(id: number): Promise<StockSchedule> {
  return request<StockSchedule>(`/schedules/${id}`);
}

export function updateSchedule(id: number, input: StockScheduleUpdateInput): Promise<StockSchedule> {
  return request<StockSchedule>(`/schedules/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function cancelSchedule(id: number): Promise<StockSchedule> {
  return request<StockSchedule>(`/schedules/${id}`, { method: "DELETE" });
}

export function fetchShops(): Promise<Shop[]> {
  return request<Shop[]>("/shops");
}

export function createShop(input: ShopCreateInput): Promise<Shop> {
  return request<Shop>("/shops", { method: "POST", body: JSON.stringify(input) });
}

export function updateShop(shopId: number, input: ShopUpdateInput): Promise<Shop> {
  return request<Shop>(`/shops/${shopId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function fetchShopDeletePhrase(): Promise<{ phrase: string }> {
  return request("/shops/delete-phrase");
}

export function deleteShop(shopId: number, confirmPhrase: string): Promise<void> {
  return request<void>(`/shops/${shopId}`, {
    method: "DELETE",
    body: JSON.stringify({ confirm_phrase: confirmPhrase }),
  });
}

export function seedDemoDataForShop(shopId: number): Promise<{ seeded: boolean }> {
  return request<{ seeded: boolean }>(`/shops/${shopId}/seed-demo`, { method: "POST" });
}

export function fetchItems(shopId: number): Promise<ItemInfo[]> {
  return request<ItemInfo[]>(`/shops/${shopId}/items`);
}

export async function fetchItem(shopId: number, itemId: string): Promise<ItemInfo | null> {
  const res = await fetch(`${API_BASE_URL}/shops/${shopId}/items/${encodeURIComponent(itemId)}`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (res.status === 401) {
    redirectToLogin();
    throw new Error("ログインが必要です");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body);
  }
  return res.json() as Promise<ItemInfo>;
}

export function fetchItemOptions(shopId: number, itemId: string): Promise<ItemOption[]> {
  return request<ItemOption[]>(`/shops/${shopId}/items/${encodeURIComponent(itemId)}/options`);
}

export function fetchItemVariations(shopId: number, itemId: string): Promise<ItemVariation[]> {
  return request<ItemVariation[]>(`/shops/${shopId}/items/${encodeURIComponent(itemId)}/variations`);
}

export function fetchManualItems(shopId: number): Promise<ManualItem[]> {
  return request<ManualItem[]>(`/shops/${shopId}/manual-items`);
}

export function createManualItem(shopId: number, input: ManualItemCreateInput): Promise<ManualItem> {
  return request<ManualItem>(`/shops/${shopId}/manual-items`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateManualItem(
  shopId: number,
  itemId: string,
  input: ManualItemUpdateInput
): Promise<ManualItem> {
  return request<ManualItem>(`/shops/${shopId}/manual-items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteManualItem(shopId: number, itemId: string): Promise<void> {
  return request<void>(`/shops/${shopId}/manual-items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
}

export function consumeManualItem(
  shopId: number,
  itemId: string,
  input: ManualItemConsumeInput
): Promise<ManualItem> {
  return request<ManualItem>(`/shops/${shopId}/manual-items/${encodeURIComponent(itemId)}/consume`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchSettings(): Promise<AppSetting[]> {
  return request<AppSetting[]>("/settings");
}

export function updateSetting(key: string, value: string): Promise<AppSetting> {
  return request<AppSetting>(`/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

export interface NotificationTestResult {
  success: boolean;
  message: string;
}

export function testNotificationWebhook(platform: string, url: string): Promise<NotificationTestResult> {
  return request<NotificationTestResult>("/settings/notification/test-webhook", {
    method: "POST",
    body: JSON.stringify({ platform, url }),
  });
}

export function testNotificationEmail(to: string): Promise<NotificationTestResult> {
  return request<NotificationTestResult>("/settings/notification/test-email", {
    method: "POST",
    body: JSON.stringify({ to }),
  });
}

export function fetchParts(): Promise<Part[]> {
  return request<Part[]>("/parts");
}

export function fetchPart(id: number): Promise<Part> {
  return request<Part>(`/parts/${id}`);
}

export function createPart(input: PartCreateInput): Promise<Part> {
  return request<Part>("/parts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePart(id: number, input: PartUpdateInput): Promise<Part> {
  return request<Part>(`/parts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deletePart(id: number): Promise<void> {
  return request<void>(`/parts/${id}`, { method: "DELETE" });
}

export function addPartStock(id: number, quantity: number, note?: string | null): Promise<Part> {
  return request<Part>(`/parts/${id}/add-stock`, {
    method: "POST",
    body: JSON.stringify({ quantity, note: note ?? null }),
  });
}

export function fetchPartReservations(id: number): Promise<ReservingOrder[]> {
  return request<ReservingOrder[]>(`/parts/${id}/reservations`);
}

export function fetchAssemblyReservations(id: number): Promise<ReservingOrder[]> {
  return request<ReservingOrder[]>(`/assemblies/${id}/reservations`);
}

export async function exportPartsCsv(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/parts/export`, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "parts.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importPartsCsv(file: File): Promise<PartImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE_URL}/parts/import`, { method: "POST", body: formData, credentials: "include" });
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.detail === "string") message = parsed.detail;
    } catch {
      // JSONでなければ生テキストのまま
    }
    throw new Error(message);
  }
  return res.json() as Promise<PartImportResult>;
}

export function fetchAssemblies(): Promise<Assembly[]> {
  return request<Assembly[]>("/assemblies");
}

// 各中間品の在庫(available)に、材料(部品/中間品)から追加で組み立てられる分を
// 加えた数(多段構成も再帰的に辿る)。BOM一覧の作成可能数計算で使用する
export function fetchAssembliesBuildableAvailable(): Promise<{ id: number; available: number }[]> {
  return request<{ id: number; available: number }[]>("/assemblies/buildable-available");
}

// 各中間品の原価(レシピの部品原価合計+自身の追加費用、多段構成も再帰的に辿る)。
// 中間品一覧・BOM編集画面の原価表示で使用する
export function fetchAssembliesCosts(): Promise<{ id: number; cost: number }[]> {
  return request<{ id: number; cost: number }[]>("/assemblies/costs");
}

export function fetchAssembly(id: number): Promise<Assembly> {
  return request<Assembly>(`/assemblies/${id}`);
}

export function createAssembly(input: AssemblyCreateInput): Promise<Assembly> {
  return request<Assembly>("/assemblies", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAssembly(id: number, input: AssemblyUpdateInput): Promise<Assembly> {
  return request<Assembly>(`/assemblies/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAssembly(id: number): Promise<void> {
  return request<void>(`/assemblies/${id}`, { method: "DELETE" });
}

export async function exportAssembliesCsv(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/assemblies/export`, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "assemblies.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importAssembliesCsv(file: File): Promise<AssemblyImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE_URL}/assemblies/import`, { method: "POST", body: formData, credentials: "include" });
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.detail === "string") message = parsed.detail;
    } catch {
      // JSONでなければ生テキストのまま
    }
    throw new Error(message);
  }
  return res.json() as Promise<AssemblyImportResult>;
}

export function fetchAssemblyRecipe(assemblyId: number): Promise<AssemblyItem[]> {
  return request<AssemblyItem[]>(`/assemblies/${assemblyId}/recipe`);
}

export function replaceAssemblyRecipe(assemblyId: number, lines: AssemblyItemInput[]): Promise<AssemblyItem[]> {
  return request<AssemblyItem[]>(`/assemblies/${assemblyId}/recipe`, {
    method: "PUT",
    body: JSON.stringify({ lines }),
  });
}

export function fetchAssemblyUsages(assemblyId: number): Promise<AssemblyUsages> {
  return request<AssemblyUsages>(`/assemblies/${assemblyId}/usages`);
}

export function buildAssembly(assemblyId: number, input: AssemblyBuildInput): Promise<StockMovement> {
  return request<StockMovement>(`/assemblies/${assemblyId}/build`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchAssemblyStockMovements(
  assemblyId: number,
  limit: number,
  offset: number
): Promise<StockMovementListResult> {
  return request<StockMovementListResult>(
    `/assemblies/${assemblyId}/stock-movements?limit=${limit}&offset=${offset}`
  );
}

export function fetchPartStockMovements(
  partId: number,
  limit: number,
  offset: number
): Promise<StockMovementListResult> {
  return request<StockMovementListResult>(`/parts/${partId}/stock-movements?limit=${limit}&offset=${offset}`);
}

export function fetchConsumptionSummary(days = 30, topN = 5): Promise<ConsumptionSummary> {
  return request<ConsumptionSummary>(`/stock-movements/consumption-summary?days=${days}&top_n=${topN}`);
}

export function fetchAssemblyBuildSummary(days = 30): Promise<AssemblyBuildSummary> {
  return request<AssemblyBuildSummary>(`/stock-movements/assembly-build-summary?days=${days}`);
}

export function fetchSalesSummary(
  days = 30,
  shopId?: number,
  dateBasis: "dispatched" | "ordered" = "dispatched"
): Promise<SalesSummary> {
  const params = new URLSearchParams({ days: String(days), date_basis: dateBasis });
  if (shopId != null) params.set("shop_id", String(shopId));
  return request<SalesSummary>(`/sales/summary?${params.toString()}`);
}

export function fetchStockMovements(
  filters: StockMovementFilters,
  limit: number,
  offset: number
): Promise<StockMovementListResult> {
  const params = new URLSearchParams();
  if (filters.component_type) params.set("component_type", filters.component_type);
  if (filters.part_id != null) params.set("part_id", String(filters.part_id));
  if (filters.assembly_id != null) params.set("assembly_id", String(filters.assembly_id));
  if (filters.reason) params.set("reason", filters.reason);
  if (filters.order_unique_key) params.set("order_unique_key", filters.order_unique_key);
  if (filters.date_from) params.set("date_from", filters.date_from);
  if (filters.date_to) params.set("date_to", filters.date_to);
  if (filters.shop_id != null) params.set("shop_id", String(filters.shop_id));
  if (filters.include_shared != null) params.set("include_shared", String(filters.include_shared));
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return request<StockMovementListResult>(`/stock-movements?${params.toString()}`);
}

export function fetchBomItems(shopId: number, itemId?: string): Promise<BomItem[]> {
  const query = itemId ? `?item_id=${encodeURIComponent(itemId)}` : "";
  return request<BomItem[]>(`/shops/${shopId}/bom${query}`);
}

export function fetchBomProducts(
  shopId: number, search: string, limit: number, offset: number
): Promise<BomListResult> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) params.set("search", search);
  return request<BomListResult>(`/shops/${shopId}/bom/products?${params.toString()}`);
}

export function replaceBomForItem(shopId: number, itemId: string, input: BomReplaceInput): Promise<BomItem[]> {
  return request<BomItem[]>(`/shops/${shopId}/bom/by-item/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function fetchBomProductSetting(shopId: number, itemId: string): Promise<BomProductSetting> {
  return request<BomProductSetting>(`/shops/${shopId}/bom/product-settings/${encodeURIComponent(itemId)}`);
}

export function updateBomProductSetting(
  shopId: number, itemId: string, matrixLayout: boolean, buildableAlertThreshold: number | null
): Promise<BomProductSetting> {
  return request<BomProductSetting>(`/shops/${shopId}/bom/product-settings/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    body: JSON.stringify({ matrix_layout: matrixLayout, buildable_alert_threshold: buildableAlertThreshold }),
  });
}

export async function exportBomCsv(shopId: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/shops/${shopId}/bom/export`, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bom.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importBomCsv(shopId: number, file: File): Promise<BomImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE_URL}/shops/${shopId}/bom/import`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.detail === "string") message = parsed.detail;
    } catch {
      // JSONでなければ生テキストのまま
    }
    throw new Error(message);
  }
  return res.json() as Promise<BomImportResult>;
}

export function fetchOrders(
  limit: number,
  offset: number,
  highlight?: string,
  shopId?: number,
  includeCancelled: boolean = true,
): Promise<OrderListResult> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (highlight) params.set("highlight", highlight);
  if (shopId != null) params.set("shop_id", String(shopId));
  if (!includeCancelled) params.set("include_cancelled", "false");
  return request<OrderListResult>(`/orders?${params.toString()}`);
}

export function syncOrdersNow(): Promise<IngestionResult> {
  return request<IngestionResult>("/orders/sync", { method: "POST" });
}

export function updateOrderDispatchStatus(orderId: number, dispatchStatus: string): Promise<Order> {
  return request<Order>(`/orders/${orderId}/dispatch-status`, {
    method: "PATCH",
    body: JSON.stringify({ dispatch_status: dispatchStatus }),
  });
}

export function undoOrderDispatch(orderId: number): Promise<Order> {
  return request<Order>(`/orders/${orderId}/undo-dispatch`, { method: "POST" });
}

export function retryOrderReservation(
  orderId: number,
  orderItemIds?: number[]
): Promise<OrderRetryReservationResult> {
  return request<OrderRetryReservationResult>(`/orders/${orderId}/retry-reservation`, {
    method: "POST",
    body: JSON.stringify({ order_item_ids: orderItemIds ?? null }),
  });
}

export function fetchOrder(orderId: number): Promise<Order> {
  return request<Order>(`/orders/${orderId}`);
}

export function createManualOrder(shopId: number, input: ManualOrderCreateInput): Promise<Order> {
  return request<Order>(`/shops/${shopId}/manual-orders`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateManualOrder(shopId: number, orderId: number, input: ManualOrderCreateInput): Promise<Order> {
  return request<Order>(`/shops/${shopId}/manual-orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function previewManualOrdersCsv(
  shopId: number,
  file: File,
  hasHeader: boolean
): Promise<ManualOrderCsvPreview> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("has_header", String(hasHeader));
  const res = await fetch(`${API_BASE_URL}/shops/${shopId}/manual-orders/import/preview`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.detail === "string") message = parsed.detail;
    } catch {
      // JSONでなければ生テキストのまま
    }
    throw new Error(message);
  }
  return res.json() as Promise<ManualOrderCsvPreview>;
}

export async function importManualOrders(
  shopId: number,
  file: File,
  mapping?: ManualOrderCsvColumnMapping,
  hasHeader = true
): Promise<ManualOrderImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  if (mapping) formData.append("mapping", JSON.stringify(mapping));
  formData.append("has_header", String(hasHeader));
  const res = await fetch(`${API_BASE_URL}/shops/${shopId}/manual-orders/import`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.detail === "string") message = parsed.detail;
    } catch {
      // JSONでなければ生テキストのまま
    }
    throw new Error(message);
  }
  return res.json() as Promise<ManualOrderImportResult>;
}

export function fetchManualOrderImportProfiles(shopId: number): Promise<ManualOrderImportProfile[]> {
  return request<ManualOrderImportProfile[]>(`/shops/${shopId}/manual-order-import-profiles`);
}

export function createManualOrderImportProfile(
  shopId: number,
  input: ManualOrderImportProfileCreateInput
): Promise<ManualOrderImportProfile> {
  return request<ManualOrderImportProfile>(`/shops/${shopId}/manual-order-import-profiles`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteManualOrderImportProfile(shopId: number, profileId: number): Promise<void> {
  return request<void>(`/shops/${shopId}/manual-order-import-profiles/${profileId}`, { method: "DELETE" });
}

export function fetchOrderSummary(
  dispatchStatus?: string,
  uniqueKeys?: string[],
  shopId?: number,
): Promise<OrderSummary> {
  const params = new URLSearchParams();
  if (uniqueKeys && uniqueKeys.length > 0) {
    params.set("unique_keys", uniqueKeys.join(","));
  } else if (dispatchStatus) {
    params.set("dispatch_status", dispatchStatus);
  }
  if (shopId != null) params.set("shop_id", String(shopId));
  const query = params.toString();
  return request<OrderSummary>(`/orders/summary${query ? `?${query}` : ""}`);
}

export function updateOrderItemPicked(orderItemId: number, picked: boolean): Promise<void> {
  return request(`/orders/items/${orderItemId}/picked`, {
    method: "PATCH",
    body: JSON.stringify({ picked }),
  });
}

export function fetchPurchaseOrders(
  limit: number,
  offset: number,
  status?: string,
  partName?: string,
  highlight?: number,
  shopId?: number
): Promise<PurchaseOrderListResult> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) params.set("status", status);
  if (partName) params.set("part_name", partName);
  if (highlight != null) params.set("highlight", String(highlight));
  if (shopId != null) params.set("shop_id", String(shopId));
  return request<PurchaseOrderListResult>(`/purchase-orders?${params.toString()}`);
}

export function fetchReorderNeeded(): Promise<ReorderNeeded[]> {
  return request<ReorderNeeded[]>("/purchase-orders/reorder-needed");
}

export function fetchLeadTimeSummary(): Promise<LeadTimeSummary> {
  return request<LeadTimeSummary>("/purchase-orders/lead-time-summary");
}

export function createPurchaseOrder(input: PurchaseOrderCreateInput): Promise<PurchaseOrder> {
  return request<PurchaseOrder>("/purchase-orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function receivePurchaseOrder(id: number, receivedAt: string): Promise<PurchaseOrder> {
  return request<PurchaseOrder>(`/purchase-orders/${id}/receive`, {
    method: "POST",
    body: JSON.stringify({ received_at: receivedAt }),
  });
}

export function undoReceivePurchaseOrder(id: number): Promise<PurchaseOrder> {
  return request<PurchaseOrder>(`/purchase-orders/${id}/undo-receive`, { method: "POST" });
}

export function cancelPurchaseOrder(id: number): Promise<PurchaseOrder> {
  return request<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { method: "POST" });
}

export function updatePurchaseOrderUrl(id: number, orderUrl: string | null): Promise<PurchaseOrder> {
  return request<PurchaseOrder>(`/purchase-orders/${id}/url`, {
    method: "PATCH",
    body: JSON.stringify({ order_url: orderUrl }),
  });
}

export function fetchResetPhrases(): Promise<{ reset_all: string; reset_order_history: string }> {
  return request("/data/reset-phrases");
}

export function resetAllData(confirmPhrase: string): Promise<void> {
  return request<void>("/data/reset-all", {
    method: "POST",
    body: JSON.stringify({ confirm_phrase: confirmPhrase }),
  });
}

export function resetOrderHistory(confirmPhrase: string): Promise<void> {
  return request<void>("/data/reset-order-history", {
    method: "POST",
    body: JSON.stringify({ confirm_phrase: confirmPhrase }),
  });
}

export function fetchRecalculateCostsPhrase(): Promise<{ phrase: string }> {
  return request("/sales/recalculate-costs-phrase");
}

export function recalculateCosts(shopId: number, confirmPhrase: string): Promise<{ updated_count: number }> {
  return request<{ updated_count: number }>(`/sales/recalculate-costs?shop_id=${shopId}`, {
    method: "POST",
    body: JSON.stringify({ confirm_phrase: confirmPhrase }),
  });
}

export interface RetentionCleanupResult {
  orders: number;
  purchase_orders: number;
  stock_schedules: number;
  stock_movements: number;
  event_logs: number;
}

export function runRetentionCleanupNow(): Promise<RetentionCleanupResult> {
  return request("/data/cleanup-retention", { method: "POST" });
}

export interface HealthStatus {
  status: string;
  demo_mode: boolean;
  version: string;
}

// 未ログインでも呼べる疎通確認エンドポイント。デモモード判定にも使う(ログイン前に
// 表示を出し分ける必要があるため、認証必須のAPIには依存できない)
export function fetchHealth(): Promise<HealthStatus> {
  return request("/health");
}

export interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string;
  // 実行中バージョン時点と最新リリース時点で、docker-compose.yml/.env.exampleの中身が
  // 変わっているかどうか(update_availableがfalseの間は常にfalse)
  config_files_changed: boolean;
}

// devビルド(未リリースのローカル/PRビルド)ではnullが返る。自動更新は行わず、
// 設定画面での通知表示にのみ使う
export function fetchUpdateCheck(): Promise<UpdateCheckResult | null> {
  return request("/version/check-update");
}

export interface OAuthStatus {
  authenticated: boolean;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  scope: string | null;
  last_synced_at: string | null;
}

export function fetchOAuthStatus(shopId: number): Promise<OAuthStatus> {
  return request(`/oauth/shops/${shopId}/status`);
}

export function fetchAuthorizeUrl(shopId: number): Promise<{ url: string }> {
  return request(`/oauth/shops/${shopId}/authorize-url`);
}

export function exchangeOAuthCode(shopId: number, code: string): Promise<OAuthStatus> {
  return request(`/oauth/shops/${shopId}/exchange-code`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function disconnectShop(shopId: number): Promise<void> {
  return request(`/oauth/shops/${shopId}/connection`, { method: "DELETE" });
}

export function fetchEventLogs(
  limit: number,
  offset: number,
  highlight?: number,
  shopId?: number,
  includeShared?: boolean
): Promise<EventLogListResult> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (highlight != null) params.set("highlight", String(highlight));
  if (shopId != null) params.set("shop_id", String(shopId));
  if (includeShared != null) params.set("include_shared", String(includeShared));
  return request(`/event-logs?${params.toString()}`);
}

export function providerLoginUrl(provider: OAuthProvider): string {
  return `${API_BASE_URL}/auth/${provider}/login`;
}

// クライアントID/シークレットが.envに設定済みのプロバイダのみ返る(ログイン画面で
// ボタンを出し分けるため)。未ログインでも呼べる公開エンドポイント
export function fetchConfiguredProviders(): Promise<OAuthProvider[]> {
  return request<OAuthProvider[]>("/auth/providers");
}

export function fetchCurrentUser(): Promise<CurrentUser> {
  return request<CurrentUser>("/auth/me");
}

// イベントログだけは「エラー総数」ではなく「最後にこのブラウザでイベントログ画面を開いて
// 以降に増えた件数」を通知する(既読管理)。他の項目は都度の実件数のため対象外
export const EVENT_LOGS_LAST_SEEN_KEY = "unistock.eventLogsLastSeenAt";

// サイドバーの通知バッジ用件数(注文/ピッキング/イベントログ/リストック予約/発注管理)
export function fetchNavCounts(shopId?: number): Promise<NavCounts> {
  const since = localStorage.getItem(EVENT_LOGS_LAST_SEEN_KEY);
  const params = new URLSearchParams();
  if (since) params.set("event_logs_since", since);
  if (shopId != null) params.set("shop_id", String(shopId));
  const query = params.toString();
  return request<NavCounts>(`/nav-counts${query ? `?${query}` : ""}`);
}

export function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

export function fetchAllowedUsers(): Promise<AllowedUser[]> {
  return request<AllowedUser[]>("/allowed-users");
}

export function createAllowedUser(input: AllowedUserCreateInput): Promise<AllowedUser> {
  return request<AllowedUser>("/allowed-users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteAllowedUser(id: number): Promise<void> {
  return request<void>(`/allowed-users/${id}`, { method: "DELETE" });
}

export function fetchApiKeys(): Promise<ApiKey[]> {
  return request<ApiKey[]>("/api-keys");
}

export function createApiKey(name: string): Promise<ApiKeyCreateResult> {
  return request<ApiKeyCreateResult>("/api-keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function revokeApiKey(id: number): Promise<void> {
  return request<void>(`/api-keys/${id}`, { method: "DELETE" });
}
