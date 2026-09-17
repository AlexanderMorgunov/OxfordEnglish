/**
 * Who is selling, in one place.
 *
 * The acquirer requires these to be visible ON the site — not only inside the offer — so they are read
 * by the global footer as well as by /terms. One copy, because two would eventually disagree and the
 * disagreeing one would be the legal document.
 */
export const SELLER = {
  name: 'Моргунов Александр Сергеевич',
  /** Self-employed (НПД), deliberately not an ИП — see docs/legal-status-and-billing. */
  inn: '361302397520',
  // The only contact channel published, by choice. The acquirer confirmed a phone number is not
  // required, and publishing one invites calls to a line nobody answers — where the offer, the refund
  // procedure and the support page all name the same e-mail.
  email: 'morgunowalex@gmail.com',
  site: 'https://dayenglish.ru',
} as const;
