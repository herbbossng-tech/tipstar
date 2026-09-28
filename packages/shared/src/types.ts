/** ISO-8601 timestamp string. Branded alias for readability/intent only. */
export type ISODateString = string;

export type UUID = string;

/** A value that may be unavailable from a given source — never fabricated. */
export type Unavailable = null;

export type Maybe<T> = T | Unavailable;

/** The three supported deployment environments (Master Blueprint V1.0). */
export const Environment = {
  DEVELOPMENT: "development",
  STAGING: "staging",
  PRODUCTION: "production",
} as const;
export type Environment = (typeof Environment)[keyof typeof Environment];
