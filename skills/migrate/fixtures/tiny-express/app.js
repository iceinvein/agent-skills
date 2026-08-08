const express = require('express')
const settings = require('./settings.json')
const app = express()

// Workflow step 1: a signup stores a pending welcome email.
const pendingWelcomes = new Map()

app.get('/api/users', (req, res) => res.json([].slice(0, settings.maxUsersPerPage)))

app.post('/api/users', (req, res) => {
  const id = Date.now()
  pendingWelcomes.set(id, req.body.email)
  res.status(201).json({ id })
})

// Workflow step 2: the welcome route consumes the state step 1 stored, then
// calls the mailer service to actually send it.
app.get('/api/users/:id/welcome', (req, res) => {
  const email = pendingWelcomes.get(Number(req.params.id))
  if (settings.welcomeEmailEnabled && email) {
    fetch('https://mailer.example.com/send', {
      method: 'POST',
      body: JSON.stringify({ to: email }),
    })
  }
  res.json({ sent: Boolean(email) })
})

module.exports = app
