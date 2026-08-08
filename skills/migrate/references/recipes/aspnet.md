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
--include='*.ext' '<pattern>' <path>` finds the same matches on real BSD
`grep`; the one place the exact pattern text has to differ between the two
tools is noted where it occurs (tables' raw-ADO probe). Replace `<source>`
with the checkout root. These are starting points, not a fixed script:
adapt the glob and the pattern to how a real source actually lays things
out, and the surface's lens census is what decides whether the result is
complete, not this file. See `references/recipes/README.md` for the
contract this file fills in, and `references/phases/enumerate.md` for the
contract itself.

Every probe below was run against three throwaway ASP.NET-shaped trees
built independently of each other (different directory layouts, different
C# formatting, different edge cases in the same construct, including
partial-class controllers, multi-part and bracket-quoted SQL identifiers,
and WebForms master pages) before being written down. Where a probe missed
something planted in one of those trees, or, worse, returned a name that
did not correspond to a real element, the probe was fixed and every tree
was re-checked; where a gap cannot be closed (noted per-direction below),
it is stated rather than the claim weakened around it. Independent review
against trees built without sight of these fixtures has twice found gaps
these trees did not exercise; each is folded into the fixes and disclosures
below rather than only into this file's revision history.

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
  Known gap, overcounting (RoutePrefix): a class-level `[RoutePrefix("...")]`
  line matches too, and it annotates no action at all: it is a prefix
  applied to every action underneath it, not a route of its own. Exclude it
  entirely before counting anything; it is not a case of one action
  matched twice, it is a line that never named an action to begin with.
  This differs from convention routing's disclosed `MapRoute`/
  `MapHttpRoute` gap in one important way: `MapRoute` is a separately
  labelled supporting probe, run outside the regex this direction counts,
  so nothing about it was ever in the tally to subtract from. `RoutePrefix`
  is matched by the very regex this direction counts, so it has to be
  subtracted from that count directly, a stronger and easier-to-miss
  burden on the reader than a probe whose result was never combined with
  this one's in the first place.
  Known gap, overcounting (split attributes): the verb attribute and the
  `Route` attribute frequently sit on separate lines rather than combined
  in one bracket (`[HttpGet]` on one line, `[Route("...")]` on the next),
  and both lines match, naming the same action twice. Run against a
  controller with one `RoutePrefix` and three actions, each written with
  its verb and `Route` attributes on separate lines, this probe returns
  seven matched lines: one `RoutePrefix` plus two lines per action.
  Excluding the `RoutePrefix` line (the paragraph above) leaves six;
  deduplicating each action's two lines down to the one action they both
  annotate leaves three, the count this direction reports, the same unit
  convention routing counts, not the raw seven matched lines.
- **Convention routing (code)**: public action methods on a class whose name
  contains `Controller`. A convention-routed action carries no attribute at
  all, so the registration statement is not a stand-in for it: counting
  `MapRoute` / `MapHttpRoute` calls instead of actions undercounts by orders
  of magnitude, because one registration statement can service every
  conventionally-routed action in the project. The count this direction
  reports has to be actions, since that is the unit `routes` is counting.
  The glob is `*Controller*.cs`, not the narrower `*Controller.cs`: a
  partial class split across `ReportsController.cs` and
  `ReportsController.Extra.cs` has actions in both files, and the narrower
  glob never reaches the second one, which undercounts in exactly the way
  that breaks `total <= sum(directions)` when nothing else is there to mask
  it.
  Probe: `rg -n -g '*Controller*.cs' 'public\s+\S+\s+\w+\s*\(' <source>`
  Supporting evidence, not the count: `rg -n -g '*.cs' '\.MapRoute\(|MapHttpRoute\(' <source>`
  confirms a conventional route table is actually registered, which is
  worth knowing even though it does not say how many actions it serves.
  Known gap, overlap: this probe's matches overlap the attribute-routing
  direction above, because an attribute-routed action is still a public
  method in a `*Controller*.cs` file. The two directions are not
  independent counts of disjoint evidence; they are two ways of finding
  some of the same actions plus each other's blind spots (attributes this
  probe cannot see are named here, and conventionally-routed actions the
  other probe cannot see are named there). Do not sum the two raw counts
  into `total`: dedupe by action identity (class plus method, or the
  resolved URL) the same way `enumerate.md`'s merge step already requires
  whenever two directions both name the same real element, and record the
  deduped count. Known gap, false positives: the widened glob also matches
  a file like `UsersControllerTests.cs`, and the pattern itself matches a
  comment or string shaped like a method signature, the same class of
  false positive the attribute-routing direction discloses above; both are
  classification-time calls for the enumerating agent, not something the
  probe can rule out.
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
  This probe does not extract a name at all: an earlier version stripped the
  match down to a single capture group (`-o -r '$2'`), and that convenience
  is what let it fabricate a table name that never existed. A stray `UPDATE`
  or `FROM` inside a comment (`// ... no FROM/INTO/UPDATE verb in the
  command`) extracted the next bare word as if it were a real identifier,
  and a three-part name (`FROM ReportingServer.dbo.Orders`) resolved to the
  middle qualifier (`dbo`) instead of the table, the same bug Finding 4
  closed one level down. A fabricated name is worse than a miss: it enters
  the ledger looking exactly like a real one, and nothing downstream can
  tell the difference. So this probe prints the whole matched line instead,
  and a person or agent reads the actual table name out of it rather than
  trusting an auto-extracted token.
  Probe: `rg -n -g '*.cs' '(FROM|INTO|UPDATE)\s+((\[[^]]+\]|\w+)\.)*(\[[^]]+\]|\w+)' <source> | grep -Ev '^[^:]+:[0-9]+:[[:space:]]*//'`
  The pattern itself also had to change to stop under-matching: `\w+` alone
  cannot start on a bracket, so `UPDATE [dbo].[Invoices]`, the ordinary
  SQL Server style for tooling-generated code, matched nothing at all
  before this fix. The alternation `\[[^]]+\]|\w+` accepts either a
  bracket-quoted segment or a plain identifier for every part of the name,
  and `(...)*` repeats that for as many dot-separated qualifiers as the
  source actually has (schema, database, linked server, or more), not just
  one. The trailing `grep -Ev` drops a line whose first non-space character
  is `//`, which is what would have caught the fabrication case above, and
  nothing else: a trailing `// ...` after real code on the same line
  survives, and so does any `/* ... */` block comment, whether it is a
  standalone line or a continuation line inside a multi-line block (a line
  starting with ` * `, the ordinary XML-doc and block-comment continuation
  style, has no `//` at all and is not touched by this filter). Verified
  directly: both a one-line `/* ... */` mentioning `UPDATE` and a
  continuation line reading `* Continuation line mentioning UPDATE
  dbo.Invoices...` inside a multi-line `/* */` block both pass through
  unfiltered, each shown as its own real, unmodified line. That does not
  reopen the fabrication this probe was fixed to close, since the full line
  is still what is shown, but it is a hit a reader has to recognise as a
  comment rather than one the pipeline discards for them.
  Known gap, precisely: bracket-quoted (`[dbo].[Invoices]`) and plain
  identifiers are handled, with any number of dot-separated qualifier
  segments. Double-quoted ANSI identifiers (`"dbo"."Invoices"`) are not.
  SQL-looking text inside an ordinary, verbatim, or interpolated string
  literal that is not actually a `SqlCommand` argument (a log message, a
  test fixture string, a piece of sample data) also matches and is shown as
  a hit; it is an honest line, not a fabricated name, but a reader
  classifying output will meet it and should expect to.
  Stored-procedure calls (`SqlCommand("EXEC dbo.RecalculateLeadScore",
  conn)`, or a `CommandType.StoredProcedure` command with the name set
  separately) name a procedure, not a table, and carry none of the
  `SELECT`/`INSERT`/`UPDATE` verb shapes this probe looks for, so they are
  invisible to it by construction, not by an oversight this probe could
  close. A table name built by string interpolation or concatenation
  (`FROM {tableName}`, `FROM " + tbl`) is the same kind of construction gap:
  the identifier a probe would need to report is not in the source text at
  all. `rg -n -g '*.cs' '(FROM|INTO|UPDATE)\s+\{' <source>` at least flags
  that call site for a person to trace by hand; it does not name the table.
  The `grep -rE --include` fallback for the primary probe above matches
  identically on real BSD `grep`, with one substitution: BSD grep does not
  accept `\]` as an escaped literal inside a negated bracket expression
  (`[^\]]` silently matches nothing, with no error message), so the class
  must be written `[^]]`, with the `]` placed first, which both `rg` and BSD
  `grep` accept the same way.

## jobs

- **Quartz.NET**: `IJob` implementations and `JobBuilder` / `ScheduleJob`
  registrations.
  Probe: `rg -n -g '*.cs' 'IJob\b|JobBuilder\.Create|ScheduleJob\(' <source>`
- **Hangfire**: `RecurringJob` and `BackgroundJob` call sites.
  Probe: `rg -n -g '*.cs' 'RecurringJob\.|BackgroundJob\.' <source>`
  Known gap: a job registered through DI (`services.AddHangfire(...)`,
  an injected `IRecurringJobManager`'s `.AddOrUpdate(...)`) never calls the
  static `RecurringJob`/`BackgroundJob` methods this probe looks for, so it
  is invisible to a static-call-only probe. A separate probe for
  `AddHangfire\(|IRecurringJobManager\b` would find the registration site,
  not the job itself, and this recipe does not attempt that second probe.
- **OS/config scheduling**: exported Windows Task Scheduler XML, and
  scheduling-flavored `web.config` `appSettings` entries (a cron string, an
  interval key), for jobs that were never wired through a .NET scheduler
  library at all.
  Probe: `rg -n -g '*.xml' -g '*.config' -i 'cron|schedule|<Task version' <source>`

## reports

- **Definitions on disk**: SSRS `.rdl` and `.rdlc` files.
  Probe: `find <source> -type f \( -name '*.rdl' -o -name '*.rdlc' \)`
- **Menu and navigation entries**: report links in a site map, a Razor
  layout, a WebForms master page, or a nav/menu partial. Scoping to
  `*.sitemap` alone misses an MVC application's ordinary navigation, which
  lives in `_Layout.cshtml`, and misses a WebForms application's, which
  lives in a `.master` page; a checkout mixing WebForms and MVC, which this
  recipe's own preamble says is the common case, needs all of these globs,
  not just the sitemap. These can also name a report the checkout no
  longer ships an `.rdl` for.
  Probe: `rg -n -g '*.sitemap' -g '_Layout.cshtml' -g '*.master' -g '*Nav*.cshtml' -g '*Menu*.cshtml' -i 'report' <source>`
  Known gap: a menu built entirely from a database table (a `Menus` or
  `NavigationItems` row set rendered at runtime, with no report name ever
  written into any file this probe reads) is unreachable by any grep
  probe, the same class of gap as the string-interpolated table name
  disclosed under `tables` above: the identifier does not exist in the
  source text.
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
- **Sitemap/nav registration**: entries in `Web.sitemap`, a Razor layout, a
  WebForms master page, or a nav/menu partial. Same scoping gap as the
  reports direction above, in both dimensions: an MVC application's real
  navigation usually lives in `_Layout.cshtml`, and a WebForms
  application's in a `.master` page, neither a sitemap; the content pattern
  also has to cover a plain WebForms anchor (`href="~/..."`) or server nav
  control (`NavigateUrl="~/..."`), not only the sitemap's XML `url=`
  attribute or MVC's `Html.ActionLink`/`Url.Action`, since a `.master` page
  almost never uses the latter two.
  Probe: `rg -n -g '*.sitemap' -g '_Layout.cshtml' -g '*.master' -g '*Nav*.cshtml' -g '*Menu*.cshtml' '(url|href|NavigateUrl)="~/|Html\.ActionLink\(|Url\.Action\(' <source>`
  Known gap: the same database-driven menu gap disclosed under `reports`
  above applies here identically, since both directions read the same
  files for the same reason.

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
