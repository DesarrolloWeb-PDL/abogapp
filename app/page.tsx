import { redirect } from "next/navigation";

/**
 * The M1 slice has no landing page: the app opens on the expedientes list
 * (the auth guard bounces to /login when there is no session).
 */
export default function Home() {
  redirect("/expedientes");
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
