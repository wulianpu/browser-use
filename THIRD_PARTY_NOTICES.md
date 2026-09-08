# Third-Party Notices

This plugin distributes **no upstream Browser Use runtime code**: the runtime and its
dependencies are resolved by `uvx` from the package registry at install/first-use time. It does
include an **adapted copy of the upstream Browser Use Skill** (`skills/browser-use/SKILL.md`),
synced from the upstream repository under its MIT license with the adaptation classes documented
in the README. The identities below are the reviewed runtime baseline recorded in
`upstream.lock.json` (spec §10/§15/§95).

| Component | Version at pin | License (as declared upstream) | Source |
| --- | --- | --- | --- |
| browser-use | 0.13.10 | MIT | https://github.com/browser-use/browser-use |
| browser-harness | 0.1.13 | MIT | https://github.com/browser-use/browser-harness |
| cdp-use | 1.4.5 | MIT (declared by upstream dependency set) | resolved via browser-use |
| mcp (Python SDK) | 2.1.1 | MIT (Anthropic) | resolved via browser-use |
| uv / uvx (launcher) | any recent | Apache-2.0 OR MIT (Astral) | https://github.com/astral-sh/uv |

Notes:

- Google Chrome / Chromium is a user-installed system application; it is neither bundled nor
  modified by this plugin, and the user's Chrome profile is never touched on uninstall.
- The upstream Browser Harness ships a PostHog telemetry client (opt-out upstream). This plugin
  disables it explicitly via `BH_TELEMETRY=false` / `BROWSER_HARNESS_TELEMETRY=false` /
  `ANONYMIZED_TELEMETRY=false`.
- The skill content in `skills/browser-use/SKILL.md` is a reviewed, adapted sync of the upstream
  `browser-use/browser-use` skill (blob SHA `d47beef3bcdf7ea42275442bb1fdaaf87f9185ed`), used
  under its MIT license (also declared in the skill's frontmatter); adaptation classes are
  limited to portable frontmatter, host security policy, and V1 product scope.
- The vendored Agent Plugins schemas under `tests/manifest/schemas/` are pristine copies of the
  published schema files, used for validation only.
- Before publishing, re-verify each license against the actual pinned artifacts as part of the
  upstream upgrade review (spec §72/§95).
