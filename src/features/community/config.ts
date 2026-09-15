/**
 * Public repo + the one channel we actually commit to answering.
 *
 * The repo link stays because "the code is open" is a claim about PRIVACY that a user can go and check
 * — the differentiator of this product. What was removed is the invitation to contribute: issues and
 * discussions promise responsiveness we do not intend to provide, and an unanswered issue at the top
 * of the repo tells a prospective user the project is abandoned. Feedback has its own in-app form.
 *
 * Security reports moved off GitHub Private Vulnerability Reporting to plain email: it only works if
 * someone checks that tab, and email is checked.
 */
export const REPO_URL = 'https://github.com/AlexanderMorgunov/OxfordEnglish';

/** Where to send a vulnerability privately. Empty hides the block rather than showing a dead channel. */
export const SECURITY_EMAIL = import.meta.env.VITE_SECURITY_EMAIL ?? 'morgunowalex@gmail.com';
