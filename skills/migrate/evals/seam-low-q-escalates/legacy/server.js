const express = require('express')
const cron = require('node-cron')
const Database = require('better-sqlite3')

const db = new Database('billing.db')
const app = express()
app.use(express.json())

app.get('/api/customers', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers').all()
  const invoices = db.prepare('SELECT * FROM invoices').all()
  const payments = db.prepare('SELECT * FROM payments').all()
  res.json(
    customers.map((c) => {
      const billed = invoices.filter((i) => i.customer_ref === c.code).reduce((s, i) => s + i.total, 0)
      const paid = payments.filter((p) => p.payer === c.code).reduce((s, p) => s + p.amount, 0)
      return { code: c.code, name: c.name, balance: billed - paid }
    }),
  )
})

app.get('/api/invoices', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers').all()
  const invoices = db.prepare('SELECT * FROM invoices').all()
  const payments = db.prepare('SELECT * FROM payments').all()
  res.json(
    invoices.map((i) => ({
      number: i.number,
      customer: (customers.find((c) => c.code === i.customer_ref) || {}).name,
      total: i.total,
      paid: payments.filter((p) => p.invoice_no === i.number).reduce((s, p) => s + p.amount, 0),
    })),
  )
})

app.post('/api/payments', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE code = ?').get(req.body.payer)
  const invoice = db.prepare('SELECT * FROM invoices WHERE number = ?').get(req.body.invoice_no)
  if (!customer || !invoice) return res.status(400).json({ error: 'unknown payer or invoice' })
  const prior = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_no = ?')
    .get(invoice.number).paid
  if (prior + req.body.amount > invoice.total) {
    return res.status(400).json({ error: 'payment exceeds the amount outstanding' })
  }
  db.prepare('INSERT INTO payments (invoice_no, payer, amount, paid_on) VALUES (?, ?, ?, ?)').run(
    invoice.number,
    customer.code,
    req.body.amount,
    new Date().toISOString(),
  )
  res.status(201).end()
})

app.get('/api/dashboard', (req, res) => {
  const customers = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n
  const billed = db.prepare('SELECT COALESCE(SUM(total), 0) AS t FROM invoices').get().t
  const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM payments').get().t
  res.json({ customers, billed, paid, outstanding: billed - paid })
})

// Nightly at 06:00: flag every invoice past its due date that is not paid in full.
cron.schedule('0 6 * * *', () => {
  const customers = db.prepare('SELECT * FROM customers').all()
  const invoices = db.prepare('SELECT * FROM invoices WHERE due_on < ?').all(new Date().toISOString())
  const payments = db.prepare('SELECT * FROM payments').all()
  for (const i of invoices) {
    const paid = payments.filter((p) => p.invoice_no === i.number).reduce((s, p) => s + p.amount, 0)
    if (paid < i.total) {
      const c = customers.find((x) => x.code === i.customer_ref)
      console.log(`overdue: invoice ${i.number} for ${c ? c.email : 'unknown customer'}`)
    }
  }
})

app.listen(3000)
