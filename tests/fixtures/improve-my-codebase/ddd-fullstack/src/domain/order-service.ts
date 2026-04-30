import type { Order, OrderId } from "./order.ts";

const orderDb = new Map<OrderId, Order>();
const inventoryDb = new Map<string, number>();
const paymentDb = new Map<string, { authorized: boolean; amount: number }>();
const auditLog: string[] = [];

export class OrderService {
  applyDiscount(orderId: OrderId, mode: "percent" | "fixed", value: number): Order {
    const order = orderDb.get(orderId);
    if (!order) throw new Error("not found");

    let newTotal: number;
    if (mode === "percent") {
      newTotal = order.total * (1 - value / 100);
    } else {
      newTotal = order.total - value;
    }

    const updated = { ...order, total: newTotal };
    orderDb.set(orderId, updated);
    auditLog.push(`discount applied to ${orderId}: mode=${mode} value=${value}`);

    return updated;
  }

  reserveInventory(orderId: OrderId): boolean {
    const order = orderDb.get(orderId);
    if (!order) throw new Error("not found");
    const current = inventoryDb.get(order.customerId) ?? 0;
    if (current < 1) return false;
    inventoryDb.set(order.customerId, current - 1);
    auditLog.push(`inventory reserved for ${orderId}`);
    return true;
  }

  authorizePayment(orderId: OrderId): boolean {
    const order = orderDb.get(orderId);
    if (!order) throw new Error("not found");
    paymentDb.set(orderId, { authorized: true, amount: order.total });
    auditLog.push(`payment authorized for ${orderId}`);
    return true;
  }

  shipOrder(orderId: OrderId): Order {
    const order = orderDb.get(orderId);
    if (!order) throw new Error("not found");
    const updated: Order = { ...order, status: "shipped" };
    orderDb.set(orderId, updated);
    auditLog.push(`order shipped: ${orderId}`);
    return updated;
  }
}
