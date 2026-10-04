migrate init --source "$PWD/legacy" --scope 'the whole tiny app' --name tiny-next --source-stack express

# Probe's hand-written half: no command writes parity-basis.md, so the replay
# writes the evidence a probe of this source would have recorded.
cat > .migrate/parity-basis.md <<'MD'
# Parity basis

Basis: source-only.

The checkout carries `app.js`, `cron.js`, `schema.sql`, `settings.json`,
`reports/` and `views/`, and no `package.json` or lockfile, so there is no
dependency set to install and nothing to start. No database dump or seed data
ships with `schema.sql`. The source has no `.git` directory, so no history is
available either.

No documentation tree exists beyond the source itself.
MD
