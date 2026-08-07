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
--include='*.ext' '<pattern>' <path>` finds the same matches; both flag sets
were checked against the BSD `grep` macOS ships. Replace `<source>` with the
checkout root. These are starting points, not a fixed script: adapt the glob
and the pattern to how a real source actually lays things out, and the
surface's lens census is what decides whether the result is complete, not
this file. See `references/recipes/README.md` for the contract this file
fills in, and `references/phases/enumerate.md` for the contract itself.

## routes

- **Attribute routing (code)**: `[Route]`, `[RoutePrefix]`, and HTTP-verb
  attributes on MVC and Web API controllers.
  Probe: `rg -n -g '*.cs' '\[(Route|RoutePrefix|HttpGet|HttpPost|HttpPut|HttpDelete)\(' <source>`
- **Convention routing (code)**: `MapRoute` / `MapHttpRoute` registrations in
  `RouteConfig.cs` / `WebApiConfig.cs`. This is how a controller with no
  routing attributes at all is still reachable, so it is not redundant with
  the direction above.
  Probe: `rg -n -g '*.cs' '\.MapRoute\(|MapHttpRoute\(' <source>/App_Start`
- **WebForms filesystem**: a `.aspx` page or `.ashx` handler is its own route
  by virtue of existing on disk; there is no registration to grep for.
  Probe: `find <source> -type f \( -name '*.aspx' -o -name '*.ashx' \)`

## tables

- **DDL**: `CREATE TABLE` statements in `.sql` scripts or migration files.
  Probe: `rg -n -g '*.sql' -i '^\s*CREATE TABLE' <source>`
- **ORM**: EF `DbSet<T>` properties on a `DbContext`, and `[Table("...")]`
  attributes on the mapped classes.
  Probe: `rg -n -g '*.cs' 'DbSet<|\[Table\(' <source>`
- **Raw ADO command text**: table names embedded in `SqlCommand` /
  `CommandText` strings, for code that never goes through the ORM at all.
  Probe: `rg -n -g '*.cs' -o '(FROM|INTO|UPDATE)\s+\w+' <source>`

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
- **Menu and navigation entries**: report links in a site map or nav config.
  These can name a report the checkout no longer ships an `.rdl` for.
  Probe: `rg -n -g '*.sitemap' -i 'report' <source>`
- **Report-builder registrations**: a catalog class or config section that
  maps a report key to its `.rdl` / `.rdlc` path, independent of both
  directions above.
  Probe: `rg -n -g '*.cs' '\.rdlc?"' <source>`

## screens

- **Filesystem**: `.aspx` pages (WebForms) and `.cshtml` views (MVC).
  Probe: `find <source> -type f \( -name '*.aspx' -o -name '*.cshtml' \)`
- **Sitemap/nav registration**: entries in `Web.sitemap` or an equivalent nav
  config. These can carry a screen with no live file left, or omit one that
  still exists.
  Probe: `rg -n -g '*.sitemap' 'url="~/' <source>`

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
