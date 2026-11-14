import { redirect } from "next/navigation";

/**
 * The M1 slice has no landing page: the app opens on the expedientes list
 * (the auth guard bounces to /login when there is no session).
 */
export default function Home() {
  redirect("/expedientes");
}
