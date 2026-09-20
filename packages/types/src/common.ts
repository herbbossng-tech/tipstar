/** ISO-8601 timestamp string. Kept as a branded alias for readability/intent. */
export type ISODateString = string;

export type UUID = string;

/** A value that may be unavailable from a given provider — never fabricated. */
export type Unavailable = null;

export type Maybe<T> = T | Unavailable;
