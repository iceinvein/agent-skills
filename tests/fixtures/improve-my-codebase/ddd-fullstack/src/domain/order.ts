export type OrderId = string & { readonly __brand: "OrderId" };

export type Order = {
  readonly id: OrderId;
  readonly customerId: string;
  readonly total: number;
  readonly status: "placed" | "paid" | "shipped";
};
