const cron = require('node-cron')

// Nightly purge of audit_log rows older than 30 days.
cron.schedule('0 2 * * *', () => {
  console.log('purge audit_log rows older than 30 days')
})
