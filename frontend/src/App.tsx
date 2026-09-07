import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ShopProvider } from "./contexts/ShopContext";
import { AppShellGate } from "./components/AppShell";
import { useBackspaceNavigationGuard } from "./hooks/useBackspaceNavigationGuard";
import DashboardPage from "./pages/DashboardPage";
import ScheduleListPage from "./pages/ScheduleListPage";
import ScheduleCreatePage from "./pages/ScheduleCreatePage";
import ScheduleEditPage from "./pages/ScheduleEditPage";
import PartListPage from "./pages/PartListPage";
import PartCreatePage from "./pages/PartCreatePage";
import PartEditPage from "./pages/PartEditPage";
import AssemblyListPage from "./pages/AssemblyListPage";
import AssemblyCreatePage from "./pages/AssemblyCreatePage";
import AssemblyEditPage from "./pages/AssemblyEditPage";
import BomListPage from "./pages/BomListPage";
import BomEditPage from "./pages/BomEditPage";
import ManualItemListPage from "./pages/ManualItemListPage";
import ManualItemCreatePage from "./pages/ManualItemCreatePage";
import ManualItemEditPage from "./pages/ManualItemEditPage";
import OrderListPage from "./pages/OrderListPage";
import ManualOrderCreatePage from "./pages/ManualOrderCreatePage";
import PickingPage from "./pages/PickingPage";
import SalesPage from "./pages/SalesPage";
import PurchaseOrderListPage from "./pages/PurchaseOrderListPage";
import EventLogListPage from "./pages/EventLogListPage";
import StockMovementListPage from "./pages/StockMovementListPage";
import SettingsPage from "./pages/SettingsPage";
import ShopSettingsPage from "./pages/ShopSettingsPage";
import LoginPage from "./pages/LoginPage";
import SetupWizardPage from "./pages/SetupWizardPage";

// useBlocker(編集画面の未保存変更ガード)がデータルーター(RouterProvider)を要求するため、
// 素のBrowserRouter+<Routes>から移行した(20260905)。ルート構成自体はJSXの<Route>ツリーと
// 完全に同じ形を配列で表現しているだけで、ローダー・アクション等は使っていない
const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/setup", element: <SetupWizardPage /> },
  {
    element: <AppShellGate />,
    children: [
      { path: "/", element: <DashboardPage /> },
      { path: "/schedules", element: <ScheduleListPage /> },
      { path: "/schedules/new", element: <ScheduleCreatePage /> },
      { path: "/schedules/:id/edit", element: <ScheduleEditPage /> },
      { path: "/parts", element: <PartListPage /> },
      { path: "/parts/new", element: <PartCreatePage /> },
      { path: "/parts/:id/edit", element: <PartEditPage /> },
      { path: "/assemblies", element: <AssemblyListPage /> },
      { path: "/assemblies/new", element: <AssemblyCreatePage /> },
      { path: "/assemblies/:id/edit", element: <AssemblyEditPage /> },
      { path: "/bom", element: <BomListPage /> },
      { path: "/bom/:shopId/new", element: <BomEditPage /> },
      { path: "/bom/:shopId/:itemId/edit", element: <BomEditPage /> },
      { path: "/manual-items", element: <ManualItemListPage /> },
      { path: "/manual-items/new", element: <ManualItemCreatePage /> },
      { path: "/manual-items/:itemId/edit", element: <ManualItemEditPage /> },
      { path: "/stock-movements", element: <StockMovementListPage /> },
      { path: "/orders", element: <OrderListPage /> },
      { path: "/orders/new", element: <ManualOrderCreatePage /> },
      { path: "/orders/:orderId/edit", element: <ManualOrderCreatePage /> },
      { path: "/picking", element: <PickingPage /> },
      { path: "/sales", element: <SalesPage /> },
      { path: "/purchase-orders", element: <PurchaseOrderListPage /> },
      { path: "/event-logs", element: <EventLogListPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/shops", element: <ShopSettingsPage /> },
    ],
  },
]);

export default function App() {
  useBackspaceNavigationGuard();

  return (
    <ShopProvider>
      <RouterProvider router={router} />
    </ShopProvider>
  );
}
