# Security review — 14 October 2026

Reviewed commit: `36621e15a8d54fad2af3ae6850cf1ff8ea2ebddc`.
Reviewed Windows artifact: [`windows-release`, ID 11856775954](https://github.com/SKekana/free-cluely/actions/runs/38477786006/artifacts/11856775954).

## Follow-up: critical vulnerabilities only

The compatible audit-fix updates were committed as `48b74ec`. The next changes target the remaining critical dependency entries:

- Upgraded Electron Builder from 25.1.8 to 26.15.3. Its archive/rebuild dependencies now resolve to `tar@7.5.22`, outside all reported vulnerable tar ranges.
- Upgraded Vitest from 3.2.7 to 4.1.11. The vulnerable `tinypool` dependency is removed entirely, eliminating both its critical advisories and the affected-parent critical classification on Vitest.
- Upgraded Vite to 6.4.3 to satisfy [Vitest 4's minimum Vite requirement](https://v4.vitest.dev/guide/migration#vitest-4). This compatibility change avoids a forced incompatible dependency override. Electron's runtime and application code were not upgraded in this pass.
- Synchronized both lockfiles, documented Node 24/22.12+ for the upgraded build tools, and added `npm audit --audit-level=critical` to the Windows workflow so critical advisories block future builds without blocking solely on lower severities.

The complete npm audit now reports **0 critical, 9 high, 15 moderate, and 1 low** vulnerabilities (25 total). The production-only audit remains **0 critical, 2 high, 5 moderate, and 1 low** (8 total). `npm audit --audit-level=critical` exits successfully. Remaining application and lower-severity findings are outside the user-requested scope.

Verification passed: type checking, 24 unit tests, production build, 8 authenticated Gemini checks, and Linux/Windows x64 unpacked packaging with Electron Builder 26.15.3. The optional long soak was skipped. Windows directory packaging used the existing local override disabling executable editing because Wine is unavailable; the checked-in Windows workflow keeps its normal executable editing. Artifact checks again verified entrypoint/preload presence and exclusion of the configured key and `.env` files. Evidence: `.cache/security/npm-audit-critical-remediation.json` and `.cache/security/npm-audit-production-critical-remediation.json`.

These changes do not clear Chrome's warning or replace the existing GitHub artifact. No new release was published.

## Follow-up: `npm audit fix`

Ran the user-requested `npm audit fix` without `--force`. It changed `package-lock.json` while keeping `package.json` and its declared version ranges unchanged. npm reported 93 changed packages, 12 additions, and 4 removals. Imported the npm resolutions into `pnpm-lock.yaml` and verified that all direct dependency versions and specifiers agree.

| Scope | Before | After | Remaining severity |
| --- | ---: | ---: | --- |
| Complete graph | 71 | 38 | 3 critical, 21 high, 13 moderate, 1 low |
| Production-only graph | 17 | 8 | 2 high, 5 moderate, 1 low |

Notable updates: `axios` 1.11.0 → 1.20.0, `form-data` 4.0.4 → 4.0.6, `ws` 8.18.3 → 8.22.0, `uuid` 11.1.0 → 11.1.1, `shell-quote` 1.8.3 → 1.12.0, and `vite` 5.4.20 → 5.4.21. The remaining critical entries are `tar`, `tinypool`, and the affected parent `vitest`. Electron remains 33.4.11; it still ships in the app despite being excluded from the production-only audit. A nested PostCSS 8.4.49 also remains vulnerable even though the top-level PostCSS was updated.

`npm audit fix` returned exit code 1 because vulnerabilities remain; the install/remediation completed. pnpm 11's first import failed in its release-age policy handler. The successful retry used a command-only `minimumReleaseAge=0` override to import the already-selected npm versions; no project policy or workspace configuration was added.

Verification passed: both TypeScript checks, all 24 unit tests, the production build, and 8 authenticated checks using `gemini-3.5-flash-lite` and `gemini-3.8-live`, including Live resumption with the updated WebSocket dependency. The optional long soak was skipped. Review evidence is saved as `.cache/security/npm-audit-fix.json`, `npm-audit-fix-changes.json`, and `npm-audit-production-after-fix.json`.

The baseline findings below describe the original scanned release. These dependency changes do not fix the IPC/navigation/retention issues, sign the executables, clear Chrome's warning, or replace the existing GitHub artifact. The compatible dependency changes were subsequently committed as `48b74ec`.

## Executive summary

The current release has actionable security issues. Two application weaknesses were reproduced with disposable test files: unrestricted file deletion through IPC, and navigation to a controlled external origin retaining the privileged Electron bridge. The release also embeds an old Electron runtime and vulnerable dependencies. Both distributed executables are unsigned.

Chrome's reported message, **“Chrome blocked this download because the file is dangerous,”** needs further binary investigation. This review does not establish that the ZIP contains malware, or that the warning is a false positive. Unsigned binaries and the screenshot helper's runtime compilation are possible contributors, not a verified diagnosis. Do not disable Safe Browsing to resolve this warning.

This was a scan and report. Application code, dependency versions, and the published release were not changed.

## Scope, methods, and limitations

- Ran `npm audit --json` and `npm audit --omit=dev --json` against the lockfile and current npm advisory database. These commands report dependency advisories, not malware detections.
- Reviewed TypeScript/React/Electron entry points, preload bridge, IPC handlers, file operations, permissions, capture processes, outbound requests, HTML policy, and Windows workflow. Applied the security-best-practices skill's React/general JavaScript guidance and Electron's official guidance; the skill has no Electron-specific reference file.
- Scanned 90 tracked files for common credential patterns. Checked the configured Gemini key against tracked content and all reachable Git-history blobs (344 Git objects examined). No matches. This does not cover dangling/deleted Git objects, external forks, or every possible secret format.
- Inspected the actual GitHub artifact through ZIP range reads: 165 entries, PE headers for four application executables, and both ASAR indexes. Neither ASAR index nor the outer ZIP contains `.env` files. All four application PE headers have an empty Authenticode certificate table.
- Checked both locally built ASAR packages for the configured key and `.env` files; neither was present. Remote ASAR inspection checked filenames, not every content byte.
- Reproduced the navigation/IPC chain under production-mode Electron on headless Linux, with an isolated profile, empty API-key environment, a localhost page, and disposable files. The harness used `--no-sandbox` for this environment; that flag is not in the app's production configuration. The findings concern bridge authorization and file handling and do not depend on a Chromium sandbox escape.
- No Windows Defender, ClamAV, or multi-engine malware scan was run. No binaries were executed on Windows. The complete ZIP's hash was not independently recomputed. Static review and partial artifact inspection cannot certify an executable malware-free.

Raw audit output and local proof evidence are in the ignored `.cache/security/` directory. Research sources are cached in the ignored `.firecrawl/` directory.

## Dependency results

| Scope | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Complete dependency graph | 5 | 46 | 17 | 3 | 71 |
| `--omit=dev` | 0 | 9 | 7 | 1 | 17 |

These are npm's vulnerable-package totals, including packages affected through other packages. They are not counts of independently exploitable vulnerabilities. **Electron is a devDependency but becomes the shipped runtime**, so the production-only audit understates release exposure.

## High-priority findings

### SEC-001 — Arbitrary file deletion through the screenshot IPC endpoint

**Severity:** High. **Status:** Reproduced.

**Locations:** [electron/ipcHandlers.ts:43](electron/ipcHandlers.ts#L43), [electron/ScreenshotHelper.ts:141](electron/ScreenshotHelper.ts#L141), [electron/preload.ts:13](electron/preload.ts#L13).

**Evidence:** `delete-screenshot` passes its caller-supplied path directly to `fs.promises.unlink(path)`. There is no queue-membership, managed-directory, or file-type check before deletion. Filtering the queue happens afterward.

**Impact:** Code running in a renderer with bridge access can delete arbitrary files that the application's OS user can delete. This is a privilege-boundary violation, not evidence that arbitrary websites can invoke the app directly from an ordinary Chrome tab.

**Verification:** Both an isolated class-level test and the actual Electron navigation test successfully deleted a disposable file outside the screenshot directory and both queues. No existing user files were touched. Evidence: `.cache/security/file-deletion-proof.json` and `.cache/security/navigation-proof.json`.

**Fix:** Accept an opaque screenshot ID and resolve it through a main-process registry. At minimum, require an exact registered queue entry and canonical path confinement, reject symlinks, and validate the sender. Also restrict `analyze-image-file` and `analyze-audio-file` to registered captures or explicit native file selections; they currently accept arbitrary paths for reading/uploading. Image uploads check PNG bytes; audio-file uploads do not establish user authorization to read the supplied file.

**Mitigation:** Reject untrusted navigation and IPC senders immediately (SEC-002). This does not replace operation-level file authorization.

### SEC-002 — Untrusted navigation retains privileged bridge access

**Severity:** High. **Status:** Reproduced.

**Locations:** [electron/WindowHelper.ts:81](electron/WindowHelper.ts#L81), [electron/WindowHelper.ts:123](electron/WindowHelper.ts#L123), [electron/preload.ts:55](electron/preload.ts#L55), [electron/ipcHandlers.ts:8](electron/ipcHandlers.ts#L8), [electron/CaptureHelper.ts:16](electron/CaptureHelper.ts#L16).

**Evidence:** The preload unconditionally exposes `electronAPI`. The window has no navigation allowlist or window-open deny handler. IPC handlers do not validate the sending frame's identity and origin. Media permission approval checks `webContents.id` and permission type, but not the current trusted document or requesting origin.

**Impact:** If an attacker gets script execution in the app renderer or induces navigation in its window, attacker-controlled content can retain file, capture, provider-management, and model-request capabilities. Automatic media approval also follows the window identity rather than the trusted page. Model usage could incur charges when a key is configured.

**Verification:** Renderer-initiated navigation from the packaged HTML to a controlled `http://127.0.0.1` page succeeded. That page found `window.electronAPI`, read the non-secret provider configuration, and invoked SEC-001 successfully. No cloud requests or real-device recordings were performed. No directly exploitable HTML-injection entry point was found in normal model-output rendering; this is not a claim of a demonstrated drive-by exploit.

**Fix:** Deny untrusted main-frame navigation and new windows. Centralize authorization for every `ipcMain.handle` and `ipcMain.on`, requiring the current main frame and the exact trusted application origin/document. Match the development URL precisely; prefer a constrained application protocol for production rather than allowing arbitrary `file:` URLs. Apply equivalent origin/frame validation and explicit active-capture intent to media permission checks. Expose only operation-specific bridge methods.

**Reference:** [Electron navigation, sender-validation, and protocol guidance](https://www.electronjs.org/docs/latest/tutorial/security).

### SEC-003 — Old, vulnerable Electron runtime is shipped

**Severity:** High. **Status:** Dependency/configuration confirmed; individual exploitability not demonstrated.

**Locations:** [package.json:124](package.json#L124), [package-lock.json:5718](package-lock.json#L5718).

The lockfile installs **Electron 33.4.11**. npm reports applicable Electron advisories, including [ASAR integrity bypass](https://github.com/advisories/GHSA-vmqv-hx8q-j7mg), permission-origin handling, and additional memory-safety/security-boundary issues. Many require specific APIs or platforms not used here; this review does not claim every advisory is reachable. Updating CI to Node 24 does not update Electron's embedded Chromium/Node runtime.

**Fix:** Migrate to a currently supported, patched Electron release and retest preload compatibility, media permissions, Windows loopback, Linux capture, and packaging. Electron supports only its latest three stable major releases; consult its [support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines#version-support-policy). Do not treat the npm `dev` classification as justification to omit this upgrade.

### SEC-004 — Vulnerable shipped dependencies and build/test tooling

**Severity:** High overall. npm marks five package entries Critical; no critical application exploit was reproduced.

**Locations:** [package.json:108](package.json#L108), [package.json:137](package.json#L137), `package-lock.json`, and `pnpm-lock.yaml`.

Notable installed packages:

| Package | Installed | Assessment |
| --- | --- | --- |
| `ws` | 8.18.3 | Used by `@google/genai` in the main process. Advisories include [uninitialized memory disclosure](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) and [memory-exhaustion DoS](https://github.com/advisories/GHSA-96hv-2xvq-fx4p). The normal Live peer is Google, not an arbitrary inbound client. |
| `axios`, `form-data` | 1.11.0, 4.0.4 | High advisories. Direct app imports were not found; remove unused direct dependencies and update remaining transitive users. Installation alone does not prove the vulnerable request paths execute. |
| `sharp` | 0.33.5 | High native-image-library advisories. No production app import was found; current smoke tests use it. Remove from production if unnecessary or upgrade and verify native packaging. |
| `prismjs` via `refractor` | 1.27.0 | Moderate [DOM-clobbering advisory](https://github.com/advisories/GHSA-x7hr-w5r2-h6wg). Syntax highlighting is used, but the advisory's dangerous DOM behavior was not demonstrated in this React token-rendering path. |
| `uuid`, `diff` | 11.1.0, 7.0.0 | Advisory preconditions do not match the observed `v4` and `diffLines` usages. Update, but do not prioritize above confirmed boundary failures. |
| `shell-quote` / `concurrently`, `tinypool` / `vitest`, `tar` | See raw audit | The five Critical package entries are build/test dependencies or their affected parents. Exploitation requires the advisory's relevant input/prototype/archive conditions; ordinary `vitest run` is not proof of RCE. |
| `vite` | 5.4.20 | High development-server advisories, including Windows file restrictions. Production loads built assets, not the Vite server. Upgrade and keep development access limited. |

**Fix:** Remove unused production packages, update compatible dependencies, then perform controlled major upgrades where necessary. Keep both lockfiles consistent. Re-run both audits, type checks, unit tests, authenticated media/Live checks, and Windows packaging. Avoid `npm audit fix --force` as an unreviewed bulk remediation.

**Mitigation:** Keep the current release out of general distribution while SEC-001/002 and the runtime upgrade are pending. A low production-audit count does not establish runtime safety.

## Medium-priority findings

### SEC-005 — No production Content Security Policy

**Severity:** Medium; defense in depth.

**Locations:** [index.html:3](index.html#L3), [electron/WindowHelper.ts:8](electron/WindowHelper.ts#L8).

The app loads its HTML from `file:` and defines no CSP in the HTML or Electron response policy. It also loads Google Fonts CSS remotely. A future script-injection bug would have fewer restrictions on script execution and network exfiltration. No current `dangerouslySetInnerHTML`, `eval`, or raw HTML injection of model output was found.

**Fix:** Add a production CSP restricting scripts, workers, frames, objects, navigation-related form actions, and renderer network destinations. Keep Gemini/Ollama networking in the main process. Account for AudioWorklet modules, blob media, canvas previews, React inline styles, and any retained font sources. Prefer bundled fonts. Test the actual packaged build rather than weakening the policy broadly to make development work.

### SEC-006 — Unsigned Windows distribution with unresolved dangerous-download classification

**Severity:** Medium distribution/integrity issue. Chrome's malware classification remains unresolved.

**Locations:** [package.json:55](package.json#L55), [.github/workflows/build-windows.yml:36](.github/workflows/build-windows.yml#L36), [build logs](https://github.com/SKekana/free-cluely/actions/runs/38477786006).

The workflow log says signing was skipped because no signing information was identified. Actual PE inspection confirms an empty certificate table in:

- `Meeting Notes Coder Setup 1.0.0.exe` — 238,679,528 bytes
- `Meeting Notes Coder 1.0.0.exe` — 122,210,652 bytes
- Both unpacked `Meeting Notes Coder.exe` files

**Impact:** Users cannot establish publisher identity through Authenticode. This can affect trust and reputation checks. It does not, by itself, explain Chrome's stronger dangerous-file warning or prove a malicious payload.

The shipped `screenshot-desktop@1.15.0` Windows helper copies a batch/C# program into `%TEMP%/screenCapture`, invokes the .NET compiler, and runs the resulting helper. See `node_modules/screenshot-desktop/lib/win32/index.js:13` and `screenCapture_1.3.2.bat:16`. This is screenshot functionality, but runtime compilation and capture behavior merit binary scanning. The helper also reuses predictable existing temporary files without integrity verification. A local attacker who can modify those files can replace the helper; no privilege escalation or remote exploit of this behavior was demonstrated.

**Fix:** Scan the exact installer and portable executable with up-to-date Windows Defender and another independent engine; retain detection names and hashes. Investigate any detections before rebuilding. Consider replacing the runtime-compiled screenshot helper with Electron's capture APIs. Configure trusted Windows code signing, verify the resulting signatures, publish SHA-256 checksums, and add an automated binary-scan/release gate. If independently confirmed to be a false positive, follow [Google's publisher review guidance](https://support.google.com/webmasters/answer/3258249). Signing cannot make malicious code safe or guarantee removal of a warning.

**Artifact provenance:** The GitHub upload log reports ZIP SHA-256 `57dffcf20a2a8dbc7b62589720885b5ef2d55f62ad630c15ecd2e9682cdd1d03`. This is the CI-reported hash, not an independently recomputed local result. ZIP contents were inspected via about 13 MB of authenticated range downloads, not a complete antivirus scan.

**Reference:** [Chrome's download classifications](https://support.google.com/chrome/answer/6261569?hl=en) distinguish dangerous malware/deceptive-software findings from suspicious unfamiliar downloads; [Electron signing guidance](https://www.electronjs.org/docs/latest/tutorial/code-signing) explains publisher identification.

### SEC-007 — Screenshots can survive application restarts indefinitely

**Severity:** Medium privacy risk.

**Locations:** [electron/ScreenshotHelper.ts:19](electron/ScreenshotHelper.ts#L19), [electron/ScreenshotHelper.ts:54](electron/ScreenshotHelper.ts#L54), [electron/main.ts:351](electron/main.ts#L351).

Screenshot files are stored under persistent `userData` directories. Queues exist only in memory; reset removes known queue entries, but startup does not discover old files and shutdown only stops Live and model requests. Files left after quitting/crashing can become orphaned and survive future resets. The five-screenshot bound applies to an in-memory queue, not historical files across launches.

**Impact:** Sensitive meeting/screen content can persist longer than users expect and may be included in backups or accessed by software with access to the profile.

**Fix:** Define retention explicitly, use a private session capture directory, remove owned files on clean shutdown and stale-session startup, and offer deliberate retention only when needed. Verify reset/quit/restart/crash recovery without deleting unrelated user files. Avoid promising secure erasure on SSDs.

## Lower-priority hardening

### SEC-008 — Release pipeline has no security gate and broad token permissions

**Severity:** Low as a standalone finding; compounds dependency/distribution issues.

**Location:** [.github/workflows/build-windows.yml:1](.github/workflows/build-windows.yml#L1).

The workflow runs tests/builds and uploads `release/`, but has no dependency-audit or malware-scan gate. It does not declare restricted token permissions; the actual run log shows broad write permissions. Checkout retains Git credentials by default, and third-party actions are referenced by mutable major tags. `npm ci` executes dependency lifecycle scripts. A compromised build dependency could abuse credentials available to the runner; no compromise was observed.

**Fix:** Set explicit minimal workflow permissions (normally `contents: read` for this build), disable persisted checkout credentials, pin action commit SHAs, separate type checking and tests into independently failing steps, and add audit/binary/signature/checksum gates. Limit download artifacts to the intended installer/portable binaries and supporting checksums instead of both complete unpacked trees. Uploading the current full release directory is not itself proof of leakage; its inspected ASARs exclude `.env`.

## Positive checks and unproven claims

- Node integration is disabled and context isolation is enabled. Production does not set `webSecurity: false`, `sandbox: false`, or `--no-sandbox`.
- The preload exposes specific methods rather than raw `ipcRenderer` or event objects.
- Model output is rendered as React text/token components; no automatic execution of generated code or enabled model tools was found.
- The configured key was not found in tracked files, reachable Git history, or either local package. Common secret-pattern scanning found no tracked credentials. The HTML's Google site-verification value is a public verification token, not an API secret.
- Gemini requests normally use the Google SDK's HTTPS/WSS endpoints. Linux audio subprocesses use `execFile`/argument arrays rather than concatenating an input into a shell command.
- This review found vulnerabilities and hardening gaps, not evidence of an intentionally malicious application. It also did not clear the dangerous-download warning.

## Recommended remediation order

1. Fix IPC/frame/origin authorization and screenshot/file-path authorization together; add regressions for the demonstrated localhost-navigation and disposable-file deletion cases.
2. Upgrade Electron and vulnerable reachable runtime packages, remove unused shipped dependencies, then update build/test dependencies and both lockfiles.
3. Add CSP and capture-permission origin checks; address screenshot retention and the Windows temporary helper.
4. Rebuild on Windows, scan the exact executables, add signing/checksums and CI gates, and only then investigate a false-positive appeal if detections remain.

No fixes, commits, pushes, security-scanner uploads to third parties, or release replacements were performed during the original scan. The subsequent dependency remediation is recorded in the follow-up sections above.
