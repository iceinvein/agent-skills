# aspnet

Covers `[source].stack` values in the ASP.NET / .NET Framework family:
`aspnet-webforms`, `aspnet-mvc`, `aspnet-webapi`, and `dotnet-framework`. Real
ASP.NET sources routinely mix WebForms, MVC, and Web API in one checkout (a
WebForms app growing a Web API layer for AJAX calls is the common case), so
several surfaces below name more than the two-direction floor. That
granularity is extracted from a private plugin's own lens recipes that ran a
real migration campaign, where this mixing was the norm rather than the
exception.

Every probe uses `rg` (ripgrep). If it is not installed, `grep -rnE
--include='*.ext' '<pattern>' <path>` finds the same matches, checked against
the BSD `grep` macOS ships; the one exception is noted where it occurs
(tables' raw-ADO probe). Replace `<source>` with the checkout root. These are
starting points, not a fixed script: adapt the glob and the pattern to how a
real source actually lays things out, and the surface's lens census is what
decides whether the result is complete, not this file. See
`references/recipes/README.md` for the contract this file fills in, and
`references/phases/enumerate.md` for the contract itself.

Every probe below was run against two throwaway ASP.NET-shaped trees built
independently of each other (different directory layouts, different C#
formatting, different edge cases in the same construct) before being written
down. Where a probe missed something planted in one of those trees, the
probe was fixed and both trees were re-checked; where it cannot be fixed
(noted per-direction below), the gap is stated rather than the claim
weakened around it.

## routes

- **Attribute routing (code)**: HTTP-verb attributes (`[HttpGet]`,
  `[HttpPost]`, ...), `[Route(...)]`, and `[RoutePrefix(...)]`, in any of
  their C#-legal forms: bare (`[HttpGet]`, no parens), comma-combined with
  another attribute in the same brackets (`[HttpPost, Route("")]`), or
  spaced inside the brackets (`[ Route(...) ]`, `[Route (...)]`). A regex
  anchored to `\(` right after the attribute name, an earlier version of
  this probe, misses all of these except the plain parenthesised form.
  Probe: `rg -n -g '*.cs' '[\[,]\s*(RoutePrefix|Route|HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|HttpHead|HttpOptions)\b' <source>`
  Known gap: this also matches the same words inside a comment or a string
  (`// see [Route] above`), since the probe reads text, not parsed syntax.
  That is a classification-time false positive for the enumerating agent to
  skip, not something the regex can rule out.
- **Convention routing (code)**: public action methods on a `*Controller.cs`
  class. A convention-routed action carries no attribute at all, so the
  registration statement is not a stand-in for it: counting `MapRoute` /
  `MapHttpRoute` calls instead of actions undercounts by orders of
  magnitude, because one registration statement can service every
  conventionally-routed action in the project. The count this direction
  reports has to be actions, since that is the unit `routes` is counting.
  Probe: `rg -n -g '*Controller.cs' 'public\s+\S+\s+\w+\s*\(' <source>`
  Supporting evidence, not the count: `rg -n -g '*.cs' '\.MapRoute\(|MapHttpRoute\(' <source>`
  confirms a conventional route table is actually registered, which is
  worth knowing even though it does not say how many actions it serves.
- **WebForms filesystem**: a `.aspx` page or `.ashx` handler is its own route
  by virtue of existing on disk; there is no registration to grep for.
  Probe: `find <source> -type f \( -name '*.aspx' -o -name '*.ashx' \)`

## tables

- **DDL and migrations**: `CREATE TABLE` statements in `.sql` scripts, and
  the migration-builder calls that create a table without ever emitting
  that literal text (EF Migrations' `migrationBuilder.CreateTable(`,
  FluentMigrator's `Create.Table(`). A table defined only through a
  migration and never in a static `.sql` file is invisible to the first
  probe alone; the second is what catches it.
  Probe: `rg -n -g '*.sql' -i '^\s*CREATE TABLE' <source>`
  Probe: `rg -n -g '*.cs' 'migrationBuilder\.CreateTable\(|Create\.Table\(' <source>`
- **ORM**: EF `DbSet<T>` properties on a `DbContext`, and `[Table("...")]`
  attributes on the mapped classes.
  Probe: `rg -n -g '*.cs' 'DbSet<|\[Table\(' <source>`
- **Raw ADO command text**: table names embedded in `SqlCommand` /
  `CommandText` strings, for code that never goes through the ORM at all.
  This resolves a schema-qualified name to the table, not the schema
  (`UPDATE dbo.Invoices` yields `Invoices`), by capturing the identifier
  after an optional `schema.` prefix instead of the first word-run after
  the SQL verb.
  Probe: `rg -n -o -r '$2' -g '*.cs' '(FROM|INTO|UPDATE)\s+(?:\w+\.)?(\w+)' <source>`
  Known gap: a table name built by string interpolation or concatenation
  (`FROM {tableName}`, `FROM " + tbl`) cannot be resolved by any static
  grep; the identifier a probe would need to report is not in the source
  text at all. `rg -n -g '*.cs' '(FROM|INTO|UPDATE)\s+\{' <source>` at least
  flags the call site for a person to trace by hand; it does not name the
  table, and no probe here can close that gap. The `grep -rE --include`
  fallback for the resolving probe above also degrades: BSD `grep -o` prints
  the whole match, schema prefix included, not an isolated capture group, so
  reading the table name off a schema-qualified hit is manual with the
  fallback tool.

## jobs

- **Quartz.NET**: `IJob` implementations and `JobBuilder` / `ScheduleJob`
  registrations.
  Probe: `rg -n -g '*.cs' 'IJob\b|JobBuilder\.Create|ScheduleJob\(' <source>`
- **Hangfire**: `RecurringJob` and `BackgroundJob` call sites.
  Probe: `rg -n -g '*.cs' 'RecurringJob\.|BackgroundJob\.' <source>`
- **OS/config scheduling**: exported Windows Task Scheduler XML, and
  scheduling-flavored `web.config` `appSettings` entries (a cron string, an
  interval key), for jobs that were never wired through a .NET scheduler
  library at all.
  Probe: `rg -n -g '*.xml' -g '*.config' -i 'cron|schedule|<Task version' <source>`

## reports

- **Definitions on disk**: SSRS `.rdl` and `.rdlc` files.
  Probe: `find <source> -type f \( -name '*.rdl' -o -name '*.rdlc' \)`
- **Menu and navigation entries**: report links in a site map, a Razor
  layout, or a nav/menu partial. Scoping to `*.sitemap` alone misses an MVC
  application's ordinary navigation, which lives in `_Layout.cshtml` or a
  partial like `_Nav.cshtml`, not a sitemap file; a checkout mixing WebForms
  and MVC, which this recipe's own preamble says is the common case, needs
  both globs. These can also name a report the checkout no longer ships an
  `.rdl` for.
  Probe: `rg -n -g '*.sitemap' -g '_Layout.cshtml' -g '*Nav*.cshtml' -g '*Menu*.cshtml' -i 'report' <source>`
- **Report-builder registrations**: a catalog class or config section that
  maps a report key to its `.rdl` / `.rdlc` path, independent of both
  directions above.
  Probe: `rg -n -g '*.cs' '\.rdlc?"' <source>`

## screens

- **Filesystem**: `.aspx` pages (WebForms) and `.cshtml` views (MVC). A
  shared layout or partial (`_Layout.cshtml`) matches the same glob; telling
  it apart from an actual screen is the enumerating agent's classification
  call, not something a filename pattern can make for it.
  Probe: `find <source> -type f \( -name '*.aspx' -o -name '*.cshtml' \)`
- **Sitemap/nav registration**: entries in `Web.sitemap`, a Razor layout, or
  a nav/menu partial. Same scoping gap as the reports direction above: an
  MVC application's real navigation usually lives in `_Layout.cshtml`, not
  a sitemap, so a probe scoped to `*.sitemap` alone finds nothing there.
  Probe: `rg -n -g '*.sitemap' -g '_Layout.cshtml' -g '*Nav*.cshtml' -g '*Menu*.cshtml' 'url="~/|Html\.ActionLink\(|Url\.Action\(' <source>`

## integrations

- **Outbound HTTP call sites (code)**: `HttpClient` and `WebClient`
  construction.
  Probe: `rg -n -g '*.cs' 'new HttpClient\(|new WebClient\(' <source>`
- **WCF service references (code)**: `ClientBase<T>` / `ChannelFactory<T>`
  proxies and `[ServiceContract]` interfaces.
  Probe: `rg -n -g '*.cs' 'ClientBase<|ChannelFactory<|\[ServiceContract\]' <source>`
- **Configured endpoints**: `<endpoint>` entries under
  `<system.serviceModel><client>` in `web.config`, which can name an
  integration no call site in code constructs directly (a proxy generated
  entirely from config at runtime).
  Probe: `rg -n -g '*.config' '<endpoint\b' <source>`

## workflows

- **Multi-step controller flow (code)**: a wizard-shaped controller with
  sequentially named actions (`Step1`, `Step2`, ...).
  Probe: `rg -n -g '*.cs' 'ActionResult Step[0-9]+' <source>`
- **State carriers (code)**: `Session[...]` and `TempData[...]` reads and
  writes tying those steps together, independent of how the actions
  themselves happen to be named.
  Probe: `rg -n -g '*.cs' 'Session\[|TempData\[' <source>`

## settings

- **Storage**: `appSettings` and `connectionStrings` entries in
  `web.config`.
  Probe: `rg -n -g '*.config' '<add (key|name)=' <source>`
- **Read sites**: `ConfigurationManager.AppSettings[...]` and
  `ConfigurationManager.ConnectionStrings[...]` reads in code, which can name
  a key `web.config` never declares (an environment-variable override, a key
  added only at deploy time).
  Probe: `rg -n -g '*.cs' 'ConfigurationManager\.(AppSettings|ConnectionStrings)' <source>`
