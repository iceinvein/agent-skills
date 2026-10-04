CREATE TABLE customers (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);

CREATE TABLE invoices (
  number TEXT PRIMARY KEY,
  customer_ref TEXT NOT NULL,
  total INTEGER NOT NULL,
  due_on TEXT NOT NULL
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL,
  payer TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_on TEXT NOT NULL
);
