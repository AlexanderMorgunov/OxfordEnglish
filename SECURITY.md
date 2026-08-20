# Security Policy

Thanks for helping keep this project and its users safe. This is a **free, open-source,
offline-first PWA with no backend and no user accounts** — please read the scope below before
reporting, so reports stay useful and easy to triage.

## Reporting a vulnerability

**Please do not open a public issue for security bugs.**

Use GitHub **Private Vulnerability Reporting**: go to the repository's **Security** tab →
**Report a vulnerability**. This opens a private advisory only the maintainer can see, and
credits you automatically when it's published.

Please include: affected version/commit, a clear description, reproduction steps, and impact.
A proof of concept helps a lot.

## Response

This is maintained by one person in their spare time. Expect an acknowledgement within about
**7 days**, and a fix or a plan for one within a reasonable time after triage. Fixed issues are
disclosed as published GitHub Security Advisories, which credit the reporter.

## Recognition

There is **no paid bounty** — the project is free and non-commercial. Valid reports are credited
by name (with a link, if you want one) on the published advisory and in the app's acknowledgements.
Higher-quality reports (clear repro, PoC, suggested fix) get more prominent credit.

## In scope

The client application and how it handles untrusted data:

- **XSS / injection** via imported or bring-your-own content packs, book files (EPUB/FB2/DOCX/PDF),
  or any rendered user-supplied text.
- **Local data handling** — how the app stores things in IndexedDB / OPFS / `localStorage`,
  including any bring-your-own AI key.
- **Service worker / cache** trust and scope issues.
- **Content-pack integrity** — a malicious pack bypassing validation.
- **Supply chain** in the build / dependencies that ships exploitable code to users.

## Out of scope

To keep triage light, the following are generally **not** accepted:

- Self-XSS (attacks requiring the victim to paste attacker code into their own devtools/console).
- Reports that require a rooted/compromised device, physical access, or a malicious browser
  extension.
- Missing security headers or best-practice suggestions with no demonstrated impact.
- Denial of service, rate-limiting, or brute-force (there is no backend to attack).
- Automated scanner output with no verified, reproducible impact.
- Vulnerabilities in third-party dependencies that are already publicly known — report those
  upstream (we still appreciate a heads-up if we're shipping a vulnerable version).

## Safe harbor

We will not pursue or support legal action against anyone who reports in good faith, follows this
policy, avoids privacy violations and data destruction, and gives us reasonable time to fix the
issue before public disclosure.
