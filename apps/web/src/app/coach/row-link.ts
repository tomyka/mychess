// The name link of a dashboard card or row: one text line high, while its
// hit area (the `after` box) covers the whole card or row, which carries
// `relative`. So the card is the link, and the link is named by the name
// alone. Focus rings the whole card.

export const ROW_LINK =
  "font-semibold break-words text-accent after:absolute after:inset-0 after:rounded-card after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent";
