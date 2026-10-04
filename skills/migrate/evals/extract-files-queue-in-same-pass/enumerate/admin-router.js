// Audit log export for the operations team.
const admin = express.Router()

admin.get('/admin/audit-log/export', (req, res) => {
  res.type('text/csv').send('user_id,action,created_at\n')
})

