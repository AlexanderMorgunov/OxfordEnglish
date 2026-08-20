/** Public repo and the GitHub-hosted channels for feedback, requests and security reports.
 *  Per the rewards/security plan: no backend — feedback lives on GitHub (the account cost is
 *  the contributor's, not ours). Security bugs go through GitHub Private Vulnerability Reporting. */
export const REPO_URL = 'https://github.com/AlexanderMorgunov/OxfordEnglish';

/** Feature ideas → Discussions (upvote with 👍). Requires Discussions enabled on the repo. */
export const FEATURE_REQUEST_URL = `${REPO_URL}/discussions/new/choose`;
/** Bug reports → Issues. */
export const BUG_REPORT_URL = `${REPO_URL}/issues/new`;
/** Security vulnerabilities → private advisory (requires Private Vulnerability Reporting enabled). */
export const SECURITY_REPORT_URL = `${REPO_URL}/security/advisories/new`;
