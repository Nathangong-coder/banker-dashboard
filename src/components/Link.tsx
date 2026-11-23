import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * next/link with prefetching OFF unless a link asks for it (owner, 2026-11-23: ~1,900 prefetch requests in 3 days on
 * Vercel; every nav item, person and bank link in view fetched its page in the background). Pages are static and
 * small, so a click still feels instant. Import this, not next/link.
 */
export default function Link({ prefetch = false, ...rest }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...rest} />;
}
