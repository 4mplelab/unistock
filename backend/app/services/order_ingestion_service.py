import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assembly import Assembly
from app.models.assembly_item import AssemblyItem
from app.models.bom import BomItem
from app.models.order import DispatchStatus, Order, OrderItem, OrderItemOption
from app.models.order_reservation import OrderPartReservation
from app.models.part import Part
from app.providers.base import ECAuthError, ECPlatform, IECProvider, OrderDetail, OrderSummary
from app.services.address_utils import truncate_address_to_city
from app.services.bom_service import BomService
from app.services.event_log_service import EventLogService
from app.services.order_cost_service import compute_cost_by_order_item
from app.services.stock_movement_service import record_assembly_movement, record_part_movement

logger = logging.getLogger(__name__)

# ラグ・境界条件対策のマージン。タイムゾーン解釈はJSTと実機確認済みのため大きくする必要はない
# (base-api-orders-real-response-verified参照)
WATERMARK_SAFETY_MARGIN = timedelta(minutes=5)

_FINAL_STATUSES = {DispatchStatus.DISPATCHED.value, DispatchStatus.CANCELLED.value}


class UnresolvedAssemblyShortfallError(Exception):
    """レシピ未設定の中間品で、自身の在庫だけでは数量を満たせなかった場合に送出する。

    レシピがあれば材料まで遡って解決できるが、レシピが無いとこれ以上遡れない。この状態は
    「BOM未設定」「選択内容に一致するBOM行が無い」と同様、レシピ設定や中間品の追加組立で
    後から解消し得る一時的な未解決状態であり、部品(Part、これ以上遡りようがない末端)の
    在庫不足とは性質が異なる。そのため部品と同じ「在庫を超過してでも引き当てる」方針は
    適用せず、この商品の引当自体を丸ごとスキップして次回同期時に再試行する。
    """

    def __init__(self, assembly_id: int):
        self.assembly_id = assembly_id
        super().__init__(f"assembly {assembly_id} has no recipe and insufficient stock")


@dataclass
class IngestionResult:
    orders_seen: int = 0
    new_orders: int = 0
    transitioned_orders: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class ReservationDiffEntry:
    """force_retry_reservationで引当数量が変わった部品/中間品1件分(変更前→変更後)。"""

    component_type: str  # "part" | "assembly"
    component_id: int
    before: int
    after: int


class OrderIngestionService:
    """注文の取り込み方式(現状:ポーリング、将来:Webhook)から独立した共通処理層。

    sync()が唯一の入り口で、入力元がポーリングjobでも手動同期エンドポイントでも
    同じロジックで新規注文の発見・状態遷移の検知・在庫操作フック呼び出しを行う。
    """

    def __init__(self, session: AsyncSession, provider: IECProvider, shop_id: int):
        self._session = session
        self._provider = provider
        self._shop_id = shop_id

    async def compute_watermark(self, go_live_at: datetime) -> datetime:
        result = await self._session.execute(
            select(func.max(Order.ordered_at)).where(Order.shop_id == self._shop_id)
        )
        max_ordered = result.scalar_one_or_none()
        if max_ordered is None:
            return go_live_at
        return max(max_ordered, go_live_at) - WATERMARK_SAFETY_MARGIN

    async def sync(self, start_ordered: datetime) -> IngestionResult:
        result = IngestionResult()
        try:
            summaries = await self._provider.list_orders(start_ordered=start_ordered)
        except ECAuthError as e:
            logger.exception("注文一覧の取得に失敗しました(認証エラー)")
            result.errors.append(str(e))
            await EventLogService(self._session).log(
                category="auth_error",
                level="error",
                message=f"外部連携の認証エラーにより注文同期に失敗しました: {e}",
                shop_id=self._shop_id,
            )
            return result
        except Exception as e:  # noqa: BLE001
            logger.exception("注文一覧の取得に失敗しました")
            result.errors.append(str(e))
            return result

        result.orders_seen = len(summaries)

        for summary in summaries:
            try:
                await self._process_summary(summary, result)
            except Exception as e:  # noqa: BLE001
                logger.exception("注文 %s の取り込みに失敗しました", summary.unique_key)
                result.errors.append(f"{summary.unique_key}: {e}")
                # 途中で失敗した場合、セッションが壊れたままだと後続の注文処理も
                # 巻き添えで失敗するためロールバックしてセッションを使える状態に戻す
                await self._session.rollback()

        return result

    async def recheck_status(self, order: Order, result: IngestionResult) -> None:
        """BASEの注文詳細APIをunique_key指定で個別に叩き、この注文の最新状態を取り込む。

        sync()はlist_orders(start_ordered=watermark)で「直近の注文」しか再取得しないため、
        新しい注文が増えるほどwatermarkが進み、古い進行中の注文はいずれその範囲から
        永久に外れてしまう(BASEにmodified-since APIが無いことに起因する既知の制限)。
        このメソッドはwatermarkを経由せず注文を個別に指名して取得するため、その制限を
        受けない。専用のリチェックジョブ(order_status_recheck_scheduler)から、
        まだ発送/キャンセル確定していない注文だけを対象に定期的に呼び出す想定。
        """
        detail = await self._provider.get_order_detail(order.unique_key)
        if detail is None:
            logger.warning("注文 %s の詳細取得に失敗しました(連携先で削除された可能性)", order.unique_key)
            return

        # 商品単位のstatus(キャンセル等)は、注文全体のdispatch_statusが変化しなくても
        # 変わりうるため、_process_summary(注文単位の状態遷移)より先に同期しておく
        await self._sync_item_statuses(order, detail)

        # totalも商品単位キャンセルや割引の変更で変わりうるため、都度最新値に合わせる。
        # 発送確定後はBASE仕様上この関数自体が呼ばれなくなる(recheckは未確定の注文のみ対象)ため、
        # 確定後の金額は最後に取得した値のまま変わらない
        if order.total != detail.total:
            order.total = detail.total
            await self._session.commit()

        summary = OrderSummary(
            unique_key=order.unique_key,
            ordered=detail.ordered,
            dispatched=detail.dispatched,
            cancelled=detail.cancelled,
            modified=detail.modified,
            dispatch_status=detail.dispatch_status,
        )
        await self._process_summary(summary, result)

    async def _sync_item_statuses(self, order: Order, detail: OrderDetail) -> None:
        """BASEの注文明細行(detail.items)のstatusを、取り込み済みのOrderItemに反映する。

        注文全体はordered(未対応)のままその中の1商品だけBASE側でキャンセルされる
        ケースを検知するための処理。新規に商品行が増減した場合はここでは扱わない
        (注文自体の新規取り込みは_ingest_new_orderが別途行う)。
        """
        items_result = await self._session.execute(select(OrderItem).where(OrderItem.order_id == order.id))
        existing_items = list(items_result.scalars().all())
        if not existing_items:
            return

        by_base_id = {oi.base_order_item_id: oi for oi in existing_items if oi.base_order_item_id}
        # base_order_item_id未設定の行(この列を追加する前に取り込まれた過去分)だけを対象に、
        # item_id+variation_idで代替照合する
        legacy_by_key = {(oi.item_id, oi.variation_id): oi for oi in existing_items if not oi.base_order_item_id}

        changed = False
        for detail_item in detail.items:
            order_item = None
            if detail_item.order_item_id:
                order_item = by_base_id.get(detail_item.order_item_id)
            if order_item is None:
                order_item = legacy_by_key.get((detail_item.item_id, detail_item.variation_id))
                if order_item is not None and detail_item.order_item_id:
                    order_item.base_order_item_id = detail_item.order_item_id
                    changed = True
            if order_item is None:
                continue  # 新規に増えた行は対象外

            if order_item.status == detail_item.status:
                continue

            was_cancelled = order_item.status == "cancelled"
            order_item.status = detail_item.status
            changed = True

            if detail_item.status == "cancelled" and not was_cancelled:
                await self._release_item_reservation(order_item)
                order_item.reservation_applied = True
            elif was_cancelled and detail_item.status != "cancelled":
                # キャンセル解除(BASE側での訂正等)。次回の_reserveで改めて引き当てさせる
                order_item.reservation_applied = False

        if changed:
            await self._session.commit()

    async def _release_item_reservation(self, order_item: OrderItem) -> None:
        """商品単位でBASE側キャンセルされた場合に、その商品分の引当だけを解放する。

        注文全体のキャンセル(_release)と同じ解放ロジックを、対象をorder_item_idで
        絞って適用する。発送確定後の商品はBASEの仕様上キャンセルできないため、対象は
        常にapplied=False(まだ_consumeで実在庫を減らしていない)の引当行のみでよい
        """
        result = await self._session.execute(
            select(OrderPartReservation).where(
                OrderPartReservation.order_item_id == order_item.id,
                OrderPartReservation.applied.is_(False),
            )
        )
        await self._release_reservations(list(result.scalars().all()))

    async def retry_reservation(self, order: Order, result: IngestionResult) -> None:
        """保留中の部品引当(reservation_applied=False)を再試行し、成立すれば在庫操作も追随させる。

        BASE同期(sync())とは独立して動く専用のリトライジョブ(order_poller.enabledの設定に
        関わらず常時稼働する)から呼び出すための公開エントリポイント。
        """
        await self._reserve(order)
        await self._apply_stock_operation(order, result)

    async def force_retry_reservation(
        self, order: Order, order_item_ids: list[int] | None = None
    ) -> list[ReservationDiffEntry]:
        """対象商品(order_item_ids未指定なら注文内の全商品)の引当(reserved)を、
        reservation_appliedの状態を問わず強制的に再計算する(BOMを修正したのに反映
        されないケースの救済用。ユーザーが明示的に操作したときだけ呼ばれる)。

        在庫(stock)には一切触れない。既存の引当行のうちまだ未消費(applied=False)の
        分だけreservedを解放し(発送確定済みで既に実消費(applied=True)済みの分は、
        _consume時点で既にreservedから減算済みのため、ここでは触れない。二重に減算
        するとreservedがマイナスに壊れる)、全ての既存行を削除してから最新のBOM設定で
        引当を作り直す。在庫の調整は行わない(ユーザーが既に手動で在庫を直している
        場合、システム側でも動かすと二重に調整されてズレるおそれがあるため、在庫は
        ユーザーが対応する前提)。

        確定済み(発送済み/キャンセル済み)の注文は、新しく作られる引当もreservedに
        一切加算しない(applied=Trueとして扱う)。確定済み注文は既に実消費/解放が完了
        しており、新しい引当をreservedに計上したままにすると「発送済みなのに引当中の
        まま」という実態と乖離した状態になるため。結果、確定済み注文への実行は
        「引当の記録(どの部品・中間品がどれだけ必要だったか)」だけが更新され、
        reserved・stockともに変化しない。

        戻り値は変更があった部品/中間品ごとの引当数量の差分(変更前→変更後)。
        """
        stmt = select(OrderItem).where(OrderItem.order_id == order.id)
        if order_item_ids is not None:
            stmt = stmt.where(OrderItem.id.in_(order_item_ids))
        order_items = list((await self._session.execute(stmt)).scalars().all())
        if not order_items:
            return []
        target_ids = [oi.id for oi in order_items]

        reservations = list(
            (
                await self._session.execute(
                    select(OrderPartReservation).where(OrderPartReservation.order_item_id.in_(target_ids))
                )
            )
            .scalars()
            .all()
        )

        before: dict[tuple[str, int], int] = {}
        for r in reservations:
            key = ("part", r.part_id) if r.part_id is not None else ("assembly", r.assembly_id)
            before[key] = before.get(key, 0) + r.quantity

        # reservedの解放は、まだreservedに計上されたまま(applied=False)の行のみ対象。
        # applied=True(発送で実消費済み/キャンセルで解放済み)の行は、_consume/_release
        # の時点で既にreservedから減算済みのため、ここでもう一度減算するとreservedが
        # マイナスに壊れる(ck_assemblies_reserved等のCHECK制約違反で実際に発生した)。
        # stockには一切触れない
        pending = [r for r in reservations if not r.applied]
        for r in pending:
            if r.part_id is not None:
                part = (
                    await self._session.execute(select(Part).where(Part.id == r.part_id).with_for_update())
                ).scalars().one()
                part.reserved -= r.quantity
            else:
                assembly = (
                    await self._session.execute(
                        select(Assembly).where(Assembly.id == r.assembly_id).with_for_update()
                    )
                ).scalars().one()
                assembly.reserved -= r.quantity
        for r in reservations:
            await self._session.delete(r)

        await self._session.execute(
            update(OrderItem).where(OrderItem.id.in_(target_ids)).values(reservation_applied=False)
        )
        await self._session.commit()

        await self._reserve(order, force=True)

        after_reservations = list(
            (
                await self._session.execute(
                    select(OrderPartReservation).where(OrderPartReservation.order_item_id.in_(target_ids))
                )
            )
            .scalars()
            .all()
        )

        if order.dispatch_status in _FINAL_STATUSES:
            # 確定済み注文は新しい引当もreservedに計上しない(applied=Trueとして扱う)。
            # _reserveは常にreservedへ加算してapplied=Falseで作るため、ここで打ち消す
            for r in after_reservations:
                if r.part_id is not None:
                    part = (
                        await self._session.execute(select(Part).where(Part.id == r.part_id).with_for_update())
                    ).scalars().one()
                    part.reserved -= r.quantity
                else:
                    assembly = (
                        await self._session.execute(
                            select(Assembly).where(Assembly.id == r.assembly_id).with_for_update()
                        )
                    ).scalars().one()
                    assembly.reserved -= r.quantity
                r.applied = True
            await self._session.execute(
                update(OrderItem).where(OrderItem.id.in_(target_ids)).values(reservation_applied=True)
            )
            await self._session.commit()

        after: dict[tuple[str, int], int] = {}
        for r in after_reservations:
            key = ("part", r.part_id) if r.part_id is not None else ("assembly", r.assembly_id)
            after[key] = after.get(key, 0) + r.quantity

        all_keys = set(before) | set(after)
        return [
            ReservationDiffEntry(
                component_type=key[0], component_id=key[1], before=before.get(key, 0), after=after.get(key, 0)
            )
            for key in sorted(all_keys)
            if before.get(key, 0) != after.get(key, 0)
        ]

    async def _process_summary(self, summary: OrderSummary, result: IngestionResult) -> None:
        existing = await self._get_order(summary.unique_key)

        if existing is None:
            await self._ingest_new_order(summary, result)
            return

        if existing.dispatch_status == summary.dispatch_status:
            existing.dispatched_at = summary.dispatched
            existing.cancelled_at = summary.cancelled
            existing.modified_at = summary.modified
            await self._session.commit()
            # BOM未設定・選択内容不一致等で保留中の部品引当があれば、ここで再試行する
            # (BOMが後から整備されるケースに対応。バックフィル安全ルールで最初から
            # reservation_applied=Trueにしてある注文は、ここでは何もヒットしない)
            await self._reserve(existing)
            # ステータスに変化が無くても、前回このステータスになった際の在庫操作
            # (_consume/_release)が何らかの理由で未完了のままなら、ここで再試行する
            await self._apply_stock_operation(existing, result)
            return

        await self._transition_order(existing, summary, result)

    async def _get_order(self, unique_key: str) -> Order | None:
        result = await self._session.execute(
            select(Order).where(Order.shop_id == self._shop_id, Order.unique_key == unique_key)
        )
        return result.scalars().first()

    async def _ingest_new_order(self, summary: OrderSummary, result: IngestionResult) -> None:
        # 顧客情報・商品明細はdispatch_statusに関わらず必ず取得する(注文サマリ用途)
        detail = await self._provider.get_order_detail(summary.unique_key)
        await self._create_order(summary, detail)
        result.new_orders += 1

    async def ingest_manual_order(self, detail: OrderDetail) -> Order:
        """手動フォーム/CSVから直接組み立てたOrderDetailを取り込む。BASE等のポーリング経路
        (_ingest_new_order)と異なり、フォーム送信=即時登録であるべきなので、list_orders/
        sync()を介さずここから直接呼ぶ(手動プロバイダのlist_orders/get_order_detailは
        常に空を返す設計のため、そもそも定期ポーリング経由では取り込まれない)。"""
        summary = OrderSummary(
            unique_key=detail.unique_key,
            ordered=detail.ordered,
            dispatched=detail.dispatched,
            cancelled=detail.cancelled,
            modified=detail.modified,
            dispatch_status=detail.dispatch_status,
        )
        return await self._create_order(summary, detail)

    async def _create_order(self, summary: OrderSummary, detail: OrderDetail | None) -> Order:
        order = Order(
            shop_id=self._shop_id,
            platform=self._provider.platform.value,
            unique_key=summary.unique_key,
            dispatch_status=summary.dispatch_status,
            ordered_at=summary.ordered,
            dispatched_at=summary.dispatched,
            cancelled_at=summary.cancelled,
            modified_at=summary.modified,
            items_fetched=detail is not None,
            # バックフィル安全ルールにより在庫操作自体を行わない注文は、再試行対象にもしない
            stock_applied=summary.dispatch_status in _FINAL_STATUSES,
        )
        if detail is not None:
            order.last_name = detail.last_name
            order.first_name = detail.first_name
            order.prefecture = detail.prefecture
            order.address = truncate_address_to_city(detail.address)
            order.email = detail.email
            order.total = detail.total

        self._session.add(order)
        await self._session.flush()

        if detail is not None:
            for item in detail.items:
                order_item = OrderItem(
                    order_id=order.id,
                    item_id=item.item_id,
                    title=item.title,
                    quantity=item.quantity,
                    price=item.price,
                    total=item.total,
                    variation_id=item.variation_id,
                    variation=item.variation,
                    status=item.status,
                    base_order_item_id=item.order_item_id,
                    # バックフィル安全ルールにより引当自体を行わない注文、または商品単位で
                    # 既にBASE側でキャンセルされている商品は、再試行対象にもしない
                    reservation_applied=summary.dispatch_status in _FINAL_STATUSES
                    or item.status == "cancelled",
                )
                self._session.add(order_item)
                await self._session.flush()

                for opt in item.options:
                    self._session.add(
                        OrderItemOption(
                            order_item_id=order_item.id,
                            option_id=opt.option_id,
                            option_variation_id=opt.option_variation_id,
                            option_name=opt.option_name,
                            option_value=opt.option_value,
                            sort_order=opt.sort_order,
                        )
                    )

        await self._session.commit()

        # バックフィル安全ルール: 初見で既に確定済み(発送/キャンセル)の注文は記録のみ、在庫操作はしない
        if summary.dispatch_status not in _FINAL_STATUSES:
            await self._reserve(order)
        return order

    async def update_manual_order(self, order: Order, detail: OrderDetail) -> Order:
        """手動ショップの注文の商品明細・顧客情報を丸ごと差し替える(データ修正用)。

        発送確定・キャンセル済みの注文は実際の在庫消費(_consume)が既に起きているため
        対象外(過去の確定済み注文は遡って補正しないという既存の_reserveの方針と揃える)。
        未消費(applied=False)の既存引当だけを解放してから明細を作り直し、改めて_reserveする。
        """
        if order.platform != ECPlatform.MANUAL.value:
            raise ValueError("手動ショップの注文以外は直接編集できません")
        if order.dispatch_status in _FINAL_STATUSES:
            raise ValueError("発送確定・キャンセル済みの注文は編集できません")

        order_items = (
            await self._session.execute(select(OrderItem).where(OrderItem.order_id == order.id))
        ).scalars().all()
        order_item_ids = [oi.id for oi in order_items]
        if order_item_ids:
            reservations = (
                await self._session.execute(
                    select(OrderPartReservation).where(OrderPartReservation.order_item_id.in_(order_item_ids))
                )
            ).scalars().all()
            # 未消費分だけreservedを解放する(consume済み=applied=Trueはdispatch_status
            # 確定後にしか発生せず、上のガードで既に除外されているはずだが念のため区別する)
            await self._release_reservations([r for r in reservations if not r.applied])
            await self._session.execute(
                delete(OrderPartReservation).where(OrderPartReservation.order_item_id.in_(order_item_ids))
            )
            await self._session.execute(
                delete(OrderItemOption).where(OrderItemOption.order_item_id.in_(order_item_ids))
            )
            await self._session.execute(delete(OrderItem).where(OrderItem.id.in_(order_item_ids)))

        order.ordered_at = detail.ordered
        order.last_name = detail.last_name
        order.first_name = detail.first_name
        order.prefecture = detail.prefecture
        order.address = truncate_address_to_city(detail.address)
        order.email = detail.email
        order.total = detail.total
        order.modified_at = datetime.now(timezone.utc)

        for item in detail.items:
            order_item = OrderItem(
                order_id=order.id,
                item_id=item.item_id,
                title=item.title,
                quantity=item.quantity,
                price=item.price,
                total=item.total,
                variation_id=item.variation_id,
                variation=item.variation,
                status=item.status,
                base_order_item_id=item.order_item_id,
                reservation_applied=False,
            )
            self._session.add(order_item)
            await self._session.flush()
            for opt in item.options:
                self._session.add(
                    OrderItemOption(
                        order_item_id=order_item.id,
                        option_id=opt.option_id,
                        option_variation_id=opt.option_variation_id,
                        option_name=opt.option_name,
                        option_value=opt.option_value,
                        sort_order=opt.sort_order,
                    )
                )

        await self._session.commit()
        await self._reserve(order)
        return order

    async def _transition_order(self, order: Order, summary: OrderSummary, result: IngestionResult) -> None:
        # BASEが返した状態は常に真実として、在庫操作の成否に関わらずまず確定・コミットする。
        # ここを在庫操作の成否で巻き戻すと、UniStock側の記録がBASEの実際の状態と食い違ってしまう。
        order.dispatch_status = summary.dispatch_status
        order.dispatched_at = summary.dispatched
        order.cancelled_at = summary.cancelled
        order.modified_at = summary.modified
        order.stock_applied = False
        await self._session.commit()
        result.transitioned_orders += 1

        # 進行中(未対応→入金待ち等)の状態遷移であれば、保留中の部品引当をここでも再試行する。
        # 遷移先が発送/キャンセル確定の場合は_reserve内部で何もしない(過去の確定済み注文は
        # 遡って補正しない方針のため)
        await self._reserve(order)
        await self._apply_stock_operation(order, result)

    async def _apply_stock_operation(self, order: Order, result: IngestionResult) -> None:
        """dispatch_statusに応じた在庫操作(_consume/_release)を行い、成功したらstock_appliedを立てる。

        BASEが発送/キャンセル確定を返している時点で、その裏付けとなる在庫変動は実際に
        起きているはずであり、_consume/_releaseが業務ロジックとして失敗することは想定しない
        (在庫不足チェックは行わない設計。Part/Assemblyのstockはマイナスも許容する)。
        それでも技術的な要因(DB接続エラー等)で失敗する可能性はゼロではないため、
        stock_appliedがFalseのままの注文は次回ポーリング時に自動的に再試行される。
        """
        if order.stock_applied:
            return
        if order.dispatch_status not in (DispatchStatus.DISPATCHED.value, DispatchStatus.CANCELLED.value):
            return

        try:
            if order.dispatch_status == DispatchStatus.DISPATCHED.value:
                await self._consume(order)
            else:
                await self._release(order)
        except Exception as e:  # noqa: BLE001
            logger.exception(
                "注文 %s の在庫操作(dispatch_status=%s)に失敗しました。次回ポーリングで再試行します",
                order.unique_key,
                order.dispatch_status,
            )
            result.errors.append(f"{order.unique_key}: 在庫操作に失敗しました(次回再試行): {e}")
            await self._session.rollback()
            await EventLogService(self._session).log(
                category="stock_operation_failed",
                level="error",
                message=f"注文 {order.unique_key} の在庫操作(dispatch_status={order.dispatch_status})に"
                f"失敗しました。次回ポーリングで再試行します: {e}",
                order_id=order.id,
                shop_id=order.shop_id,
            )
            return

        order.stock_applied = True
        await self._session.commit()

    async def set_manual_dispatch_status(self, order: Order, new_status: str) -> None:
        """手動ショップの注文のみ、ユーザー操作で発送確定/キャンセルへ状態を進める。

        BASE等の連携先を持つ注文は連携先の状態(ポーリング結果)が常に真実であるべきで、
        ここで上書きすると次回同期時に食い違いが生じるため、手動ショップの注文以外は拒否する。
        """
        if order.platform != ECPlatform.MANUAL.value:
            raise ValueError("手動ショップの注文以外はステータスを直接変更できません")
        if new_status not in _FINAL_STATUSES:
            raise ValueError(f"許可されていないステータスです: {new_status}")

        now = datetime.now(timezone.utc)
        order.dispatch_status = new_status
        if new_status == DispatchStatus.DISPATCHED.value:
            order.dispatched_at = now
        else:
            order.cancelled_at = now
        order.modified_at = now
        order.stock_applied = False
        await self._session.commit()

        result = IngestionResult()
        await self._apply_stock_operation(order, result)
        if result.errors:
            raise RuntimeError("; ".join(result.errors))

    async def undo_dispatch(self, order: Order) -> None:
        """発送済みへの変更を取り消し、注文をordered状態に戻す(誤操作の救済用、
        purchase_order_service.undo_receive_orderと同じ考え方)。

        消費済み(applied=True)の引当行を復元する(reserved/stockを両方元に戻し、
        applied=Falseへ)。これにより、注文は「発送直前にあった状態」(部品は引当済みだが
        まだ消費はされていない)にちょうど戻る。手動ショップの注文のみ許可
        (set_manual_dispatch_statusと同じ理由)。
        """
        if order.platform != ECPlatform.MANUAL.value:
            raise ValueError("手動ショップの注文以外は発送を取り消せません")
        if order.dispatch_status != DispatchStatus.DISPATCHED.value:
            raise ValueError("発送済みの注文のみ取り消せます")

        reservations = (
            await self._session.execute(
                select(OrderPartReservation).where(
                    OrderPartReservation.order_id == order.id, OrderPartReservation.applied.is_(True)
                )
            )
        ).scalars().all()

        for reservation in reservations:
            if reservation.part_id is not None:
                part = (
                    await self._session.execute(
                        select(Part).where(Part.id == reservation.part_id).with_for_update()
                    )
                ).scalars().one()
                part.reserved += reservation.quantity
                part.stock += reservation.quantity
                await record_part_movement(
                    self._session,
                    reservation.part_id,
                    reservation.quantity,
                    reason="order_dispatch_undone",
                    order_id=order.id,
                    shop_id=order.shop_id,
                )
            else:
                assembly = (
                    await self._session.execute(
                        select(Assembly).where(Assembly.id == reservation.assembly_id).with_for_update()
                    )
                ).scalars().one()
                assembly.reserved += reservation.quantity
                assembly.stock += reservation.quantity
                await record_assembly_movement(
                    self._session,
                    reservation.assembly_id,
                    reservation.quantity,
                    reason="order_dispatch_undone",
                    order_id=order.id,
                    shop_id=order.shop_id,
                )
            reservation.applied = False

        order.dispatch_status = DispatchStatus.ORDERED.value
        order.dispatched_at = None
        order.stock_applied = False
        order.modified_at = datetime.now(timezone.utc)
        await self._session.commit()

    # --- 在庫操作フック ---

    async def _reserve(self, order: Order, *, force: bool = False) -> None:
        """未引当(reservation_applied=False)のOrderItemだけを対象に部品引当を試みる。

        商品単位で冪等かつ何度でも安全に再試行できる(BOM未設定・選択内容に一致するBOM行が
        無い、等の理由で一部の商品だけスキップされても、他の商品の引当結果には影響しない)。
        スキップされた商品はreservation_appliedがFalseのまま残り、次にこの注文が同期処理
        (自動ポーリング・手動同期・専用リトライジョブ)に触れられたときに再試行される。

        対象は通常「進行中の注文」のみ。発送/キャンセルが確定した時点でBOM未設定等により
        引当できていない商品は、それ以降は遡って補正しない(過去の確定済み注文は対象外、
        というユーザー判断による)。force=Trueの場合のみこのガードを外す
        (force_retry_reservationからの、確定済み注文へのユーザー明示操作用)。
        """
        if order.dispatch_status in _FINAL_STATUSES and not force:
            return

        items_result = await self._session.execute(
            select(OrderItem).where(OrderItem.order_id == order.id, OrderItem.reservation_applied.is_(False))
        )
        order_items = list(items_result.scalars().all())
        if not order_items:
            return

        bom_service = BomService(self._session)
        part_qty: dict[int, int] = {}
        assembly_qty: dict[int, int] = {}
        # 商品(OrderItem)ごとの内訳。注文サマリで商品単位のピッキングリストを表示するため、
        # 上のpart_qty/assembly_qty(注文全体での在庫引当計算に使う共有の集計)とは別に、
        # 「この商品のために何をどれだけ引き当てたか」をoi.id単位でも記録しておく
        item_part_qty: dict[int, dict[int, int]] = {}
        item_assembly_qty: dict[int, dict[int, int]] = {}
        locked_assemblies: dict[int, Assembly] = {}
        resolved_item_ids: list[int] = []

        async def _accumulate(line: BomItem, oi: OrderItem) -> None:
            if line.part_id is None and line.assembly_id is None:
                return  # component_type='none'(部品不要マーカー): 何も消費しない
            component_type = "part" if line.part_id is not None else "assembly"
            component_id = line.part_id if line.part_id is not None else line.assembly_id
            await self._resolve_component(
                component_type,
                component_id,
                line.quantity * oi.quantity,
                part_qty,
                assembly_qty,
                item_part_qty.setdefault(oi.id, {}),
                item_assembly_qty.setdefault(oi.id, {}),
                locked_assemblies,
                order,
                oi.item_id,
            )

        for oi in order_items:
            bom_lines = await bom_service.get_bom_for_item(order.shop_id, oi.item_id)
            if not bom_lines:
                logger.warning(
                    "注文 %s の商品 item_id=%s にBOMが未設定のため、この商品の部品引当をスキップします"
                    "(次にこの注文が同期されたときに再試行します)",
                    order.unique_key,
                    oi.item_id,
                )
                await EventLogService(self._session).log(
                    category="reservation_skipped",
                    level="warning",
                    message=f"注文 {order.unique_key} の商品 item_id={oi.item_id} にBOMが未設定のため、"
                    "この商品の部品引当をスキップしました(次回同期時に再試行します)",
                    order_id=order.id,
                    item_id=oi.item_id,
                
                    shop_id=order.shop_id,
                )
                continue

            selected_option_ids = await self._get_selected_option_variation_ids(oi.id)
            selected_keys: set[tuple[str, str]] = {("option", vid) for vid in selected_option_ids}
            if oi.variation_id:
                selected_keys.add(("variation", oi.variation_id))

            # 選択したオプション/種類のうち、BOMのどの行の条件にも一度も登場しないものが
            # あれば、そのオプション/種類のBOM行が未整備とみなしてスキップする。共通行
            # (条件0件、常に適用される)が存在すると、それだけで「一致する行がある」ことに
            # なってしまい、オプション行が未整備でも見逃されてしまうため
            # (unistock-assembly-resolved-mismatch-fixと同種のバグ、2026-09-10発見)。
            referenced_keys = {(c.selector_type, c.selector_id) for line in bom_lines for c in line.conditions}
            unmatched_keys = selected_keys - referenced_keys
            if unmatched_keys:
                unmatched_desc = ", ".join(f"{t}:{i}" for t, i in sorted(unmatched_keys))
                logger.warning(
                    "注文 %s の商品 item_id=%s: 選択内容(%s)に対応するBOM行がないため、"
                    "この商品の部品引当をスキップします(次にこの注文が同期されたときに再試行します)",
                    order.unique_key,
                    oi.item_id,
                    unmatched_desc,
                )
                await EventLogService(self._session).log(
                    category="reservation_skipped",
                    level="warning",
                    message=f"注文 {order.unique_key} の商品 item_id={oi.item_id}: 選択内容({unmatched_desc})に"
                    "対応するBOM行がないため、この商品の部品引当をスキップしました(次回同期時に再試行します)",
                    order_id=order.id,
                    item_id=oi.item_id,
                    shop_id=order.shop_id,
                )
                continue

            # 各BOM行は0..N個の条件(AND)を持つ。条件が0件の行は常に適用される「共通行」、
            # 条件が1件以上ある行は、その全条件を注文の選択内容が満たしたときだけ適用される
            # (複数条件を持つ行は「右モジュール=Xかつケース=Yのときだけ」のような組み合わせ条件を表す)。
            applicable_lines = [
                line
                for line in bom_lines
                if all((c.selector_type, c.selector_id) in selected_keys for c in line.conditions)
            ]
            if not applicable_lines:
                logger.warning(
                    "注文 %s の商品 item_id=%s: BOMは設定されているが、選択内容(オプション/種類)に一致する行が"
                    "ないため、この商品の部品引当をスキップします(次にこの注文が同期されたときに再試行します)",
                    order.unique_key,
                    oi.item_id,
                )
                await EventLogService(self._session).log(
                    category="reservation_skipped",
                    level="warning",
                    message=f"注文 {order.unique_key} の商品 item_id={oi.item_id}: BOMは設定されていますが、"
                    "選択内容(オプション/種類)に一致する行がないため、この商品の部品引当をスキップしました"
                    "(次回同期時に再試行します)",
                    order_id=order.id,
                    item_id=oi.item_id,
                
                    shop_id=order.shop_id,
                )
                continue

            try:
                for line in applicable_lines:
                    await _accumulate(line, oi)
            except UnresolvedAssemblyShortfallError as e:
                # このoi(商品)の分だけ、speculativeに書き込み済みだった共有集計への
                # 寄与をitem_part_qty/item_assembly_qty[oi.id](=このoiが実際に加算した分の
                # 記録そのもの)を使って正確に巻き戻す。他の商品の引当結果には影響しない
                for pid, qty in item_part_qty.pop(oi.id, {}).items():
                    part_qty[pid] -= qty
                    if part_qty[pid] <= 0:
                        del part_qty[pid]
                for aid, qty in item_assembly_qty.pop(oi.id, {}).items():
                    assembly_qty[aid] -= qty
                    if assembly_qty[aid] <= 0:
                        del assembly_qty[aid]
                logger.warning(
                    "注文 %s の商品 item_id=%s: 中間品(id=%s)の在庫が不足し、レシピも未設定のため"
                    "この商品の部品引当をスキップします(次にこの注文が同期されたときに再試行します)",
                    order.unique_key,
                    oi.item_id,
                    e.assembly_id,
                )
                await EventLogService(self._session).log(
                    category="reservation_skipped",
                    level="warning",
                    message=f"注文 {order.unique_key} の商品 item_id={oi.item_id}: 中間品(id={e.assembly_id})の"
                    "在庫が不足し、レシピも未設定のため、この商品の部品引当をスキップしました"
                    "(次回同期時に再試行します。中間品の組み立てまたはレシピ設定をご検討ください)",
                    order_id=order.id,
                    item_id=oi.item_id,
                
                    shop_id=order.shop_id,
                )
                continue
            resolved_item_ids.append(oi.id)

        if not resolved_item_ids:
            return

        for part_id, qty in part_qty.items():
            part_result = await self._session.execute(
                select(Part).where(Part.id == part_id).with_for_update()
            )
            part = part_result.scalars().one()
            part.reserved += qty

        for assembly_id, qty in assembly_qty.items():
            assembly = locked_assemblies[assembly_id]
            assembly.reserved += qty

        # 引当台帳への書き込みは、在庫増減(上の`reserved`加算)とは別に商品(order_item)単位で行う。
        # こうすることで、在庫の按分計算は従来通り注文全体で共有しつつ、注文サマリでは
        # 「どの商品にどの部品/中間品が何個必要か」を商品ごとに正しく表示できる
        for oi_id, comp_dict in item_part_qty.items():
            for part_id, qty in comp_dict.items():
                self._session.add(
                    OrderPartReservation(order_id=order.id, order_item_id=oi_id, part_id=part_id, quantity=qty)
                )
        for oi_id, comp_dict in item_assembly_qty.items():
            for assembly_id, qty in comp_dict.items():
                self._session.add(
                    OrderPartReservation(
                        order_id=order.id, order_item_id=oi_id, assembly_id=assembly_id, quantity=qty
                    )
                )

        await self._session.execute(
            update(OrderItem).where(OrderItem.id.in_(resolved_item_ids)).values(reservation_applied=True)
        )
        await self._session.commit()

    async def _resolve_component(
        self,
        component_type: str,
        component_id: int,
        quantity: int,
        part_qty: dict[int, int],
        assembly_qty: dict[int, int],
        item_part_qty: dict[int, int],
        item_assembly_qty: dict[int, int],
        locked_assemblies: dict[int, Assembly],
        order: Order,
        item_id: str,
    ) -> None:
        """引当対象を最終的な部品まで解決する。

        中間品は「まず自身の在庫(未引当分)を優先して使い、足りない分だけ自身のレシピを
        辿って部品(または、さらに下位の中間品)を消費する」というハイブリッド方式。
        あらかじめ組み立てておいた在庫があればそれを使い、無ければその場で部品まで
        自動的に遡って引き当てる。多段構成の中間品にも再帰的に適用される。

        part_qty/assembly_qtyは注文全体で共有する在庫按分用の集計、
        item_part_qty/item_assembly_qtyは呼び出し元(_accumulate)が商品ごとに
        用意する内訳集計で、両方に同じ増分を積む。
        """
        if component_type == "part":
            part_qty[component_id] = part_qty.get(component_id, 0) + quantity
            item_part_qty[component_id] = item_part_qty.get(component_id, 0) + quantity
            return

        if component_id not in locked_assemblies:
            result = await self._session.execute(
                select(Assembly).where(Assembly.id == component_id).with_for_update()
            )
            locked_assemblies[component_id] = result.scalars().one()
        assembly = locked_assemblies[component_id]

        already_planned = assembly_qty.get(component_id, 0)
        available = assembly.stock - assembly.reserved - already_planned
        use_from_stock = max(0, min(quantity, available))
        if use_from_stock > 0:
            assembly_qty[component_id] = already_planned + use_from_stock
            item_assembly_qty[component_id] = item_assembly_qty.get(component_id, 0) + use_from_stock

        remaining = quantity - use_from_stock
        if remaining <= 0:
            return

        recipe_result = await self._session.execute(
            select(AssemblyItem).where(AssemblyItem.assembly_id == component_id)
        )
        recipe_lines = list(recipe_result.scalars().all())
        if not recipe_lines:
            # レシピが無く、これ以上部品まで遡れない。UnresolvedAssemblyShortfallErrorを
            # 送出し、呼び出し元(_reserve)でこの商品の引当全体をロールバック・スキップする
            # (このcomponentのuse_from_stock分の speculative な書き込みも含めて、
            # _reserve側でitem_assembly_qty[oi.id]の記録をもとに巻き戻される)
            raise UnresolvedAssemblyShortfallError(component_id)

        for line in recipe_lines:
            sub_component_type = "part" if line.material_part_id is not None else "assembly"
            sub_component_id = (
                line.material_part_id if line.material_part_id is not None else line.material_assembly_id
            )
            await self._resolve_component(
                sub_component_type,
                sub_component_id,
                line.quantity * remaining,
                part_qty,
                assembly_qty,
                item_part_qty,
                item_assembly_qty,
                locked_assemblies,
                order,
                item_id,
            )

    async def _consume(self, order: Order) -> None:
        reservations = await self._get_pending_reservations(order.id)
        for reservation in reservations:
            if reservation.part_id is not None:
                part_result = await self._session.execute(
                    select(Part).where(Part.id == reservation.part_id).with_for_update()
                )
                part = part_result.scalars().one()
                part.reserved -= reservation.quantity
                part.stock -= reservation.quantity
                await record_part_movement(
                    self._session,
                    reservation.part_id,
                    -reservation.quantity,
                    reason="order_consumed",
                    order_id=order.id,
                    shop_id=order.shop_id,
                )
            else:
                assembly_result = await self._session.execute(
                    select(Assembly).where(Assembly.id == reservation.assembly_id).with_for_update()
                )
                assembly = assembly_result.scalars().one()
                assembly.reserved -= reservation.quantity
                assembly.stock -= reservation.quantity
                await record_assembly_movement(
                    self._session,
                    reservation.assembly_id,
                    -reservation.quantity,
                    reason="order_consumed",
                    order_id=order.id,
                    shop_id=order.shop_id,
                )
            reservation.applied = True
        await self._confirm_order_item_costs(order)
        await self._session.commit()

    async def _confirm_order_item_costs(self, order: Order) -> None:
        """発送確定の瞬間に、この注文の各商品明細の原価を一度だけ確定して書き込む。

        以後Part/Assemblyの単価を変更しても、この注文の粗利は遡って変わらない
        (sales_service.get_sales_summaryはOrderItem.costを直接読む)。
        """
        order_items = (
            (await self._session.execute(select(OrderItem).where(OrderItem.order_id == order.id)))
            .scalars()
            .all()
        )
        cost_by_item = await compute_cost_by_order_item(self._session, [oi.id for oi in order_items], order.shop_id)
        for oi in order_items:
            oi.cost = cost_by_item.get(oi.id, 0)

    async def _release(self, order: Order) -> None:
        reservations = await self._get_pending_reservations(order.id)
        await self._release_reservations(reservations)
        await self._session.commit()

    async def _release_reservations(self, reservations: list[OrderPartReservation]) -> None:
        """引当行の一覧を対象に、reservedを解放してapplied=Trueにする(コミットは呼び出し元の責務)。

        注文全体のキャンセル(_release)と、商品単位のキャンセル(_release_item_reservation)の
        両方から共通で使う
        """
        for reservation in reservations:
            if reservation.part_id is not None:
                part_result = await self._session.execute(
                    select(Part).where(Part.id == reservation.part_id).with_for_update()
                )
                part = part_result.scalars().one()
                part.reserved -= reservation.quantity
            else:
                assembly_result = await self._session.execute(
                    select(Assembly).where(Assembly.id == reservation.assembly_id).with_for_update()
                )
                assembly = assembly_result.scalars().one()
                assembly.reserved -= reservation.quantity
            reservation.applied = True

    async def _get_selected_option_variation_ids(self, order_item_id: int) -> list[str]:
        result = await self._session.execute(
            select(OrderItemOption.option_variation_id).where(
                OrderItemOption.order_item_id == order_item_id
            )
        )
        return list(result.scalars().all())

    async def _get_pending_reservations(self, order_id: int) -> list[OrderPartReservation]:
        """まだ在庫増減(_consume/_release)を反映していない引当行だけを返す。

        _reserveは1回の呼び出しごとに新しい行を追加しうる(商品ごとの引当タイミングが
        ずれるため、同じ部品/中間品に対して複数行が存在してよい)。ここでapplied済みの
        行を除外することで、既に反映済みの行を二重に消費/解放しないようにする。
        """
        result = await self._session.execute(
            select(OrderPartReservation).where(
                OrderPartReservation.order_id == order_id, OrderPartReservation.applied.is_(False)
            )
        )
        return list(result.scalars().all())
