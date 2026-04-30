import type { OrderId } from "../domain/order.ts";

export type OrderPlaced = {
  readonly type: "OrderPlaced";
  readonly orderId: OrderId;
  readonly placedAt: Date;
};
